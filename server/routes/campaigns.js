const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');
const { parseLeadFile } = require('../utils/csvParser');
const { generateTrackingId } = require('../services/trackingService');
const { queueCampaign, pauseCampaign, resumeCampaign } = require('../services/emailQueue');
const { scheduleFollowUps } = require('../services/sequenceEngine');

// Multer setup for file uploads
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv, .xlsx, .xls files are allowed'));
    }
  },
});

// GET /api/campaigns - List all campaigns
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM leads WHERE campaign_id = c.id) as lead_count,
        (SELECT COUNT(*) FROM leads WHERE campaign_id = c.id AND status = 'sent') as actual_sent,
        (SELECT COUNT(*) FROM leads WHERE campaign_id = c.id AND status = 'queued') as queued_count,
        (SELECT COUNT(*) FROM leads WHERE campaign_id = c.id AND status = 'failed') as actual_failed
      FROM campaigns c
      ORDER BY c.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('List campaigns error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/campaigns/:id - Get campaign detail
router.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const id = req.params.id;
    
    const campaignResult = await db.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    const campaign = campaignResult.rows[0];
    
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const leadsResult = await db.query(`
      SELECT id, recipient_email, first_name, last_name, subject, status, sent_at,
             sender_email, tracking_id, open_count, click_count, last_opened_at, last_clicked_at, error_message
      FROM leads WHERE campaign_id = $1
      ORDER BY created_at ASC
    `, [id]);

    const sequencesResult = await db.query(`
      SELECT * FROM sequences WHERE campaign_id = $1 ORDER BY step_number ASC
    `, [id]);

    res.json({ ...campaign, leads: leadsResult.rows, sequences: sequencesResult.rows });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/preview - Parse file and return stats/preview without saving
router.post('/preview', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV/XLSX file is required' });

    const parseResult = parseLeadFile(req.file.path, req.file.originalname);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.errors.join('; ') });
    }

    res.json({
      totalRows: parseResult.totalRows,
      validRows: parseResult.validRows,
      invalidRows: parseResult.invalidRows,
      preview: parseResult.leads.slice(0, 5),
      errors: parseResult.errors.slice(0, 10),
    });
  } catch (error) {
    console.error('Preview campaign error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns - Create campaign with file upload
router.post('/', upload.single('file'), async (req, res) => {
  const client = await (await getDb()).connect();
  try {
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });
    if (!req.file) return res.status(400).json({ error: 'CSV/XLSX file is required' });

    const parseResult = parseLeadFile(req.file.path, req.file.originalname);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.errors.join('; ') });
    }

    if (parseResult.leads.length === 0) {
      return res.status(400).json({ error: 'No valid leads found in file' });
    }

    await client.query('BEGIN');

    // Create campaign
    const campaignResult = await client.query(`
      INSERT INTO campaigns (name, total_leads) VALUES ($1, $2) RETURNING *
    `, [name, parseResult.validRows]);

    const campaign = campaignResult.rows[0];
    const campaignId = campaign.id;

    // Insert leads
    for (const lead of parseResult.leads) {
      const trackingId = generateTrackingId();
      await client.query(`
        INSERT INTO leads (campaign_id, recipient_email, first_name, last_name, subject, body, tracking_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        campaignId,
        lead.recipient_email,
        lead.first_name,
        lead.last_name,
        lead.subject,
        lead.body,
        trackingId
      ]);
    }

    // Save sequences
    if (req.body.sequences) {
      try {
        const sequences = typeof req.body.sequences === 'string' ? JSON.parse(req.body.sequences) : req.body.sequences;
        for (const seq of sequences) {
          await client.query(`
            INSERT INTO sequences (campaign_id, step_number, delay_days, subject_template, body_template, condition)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            campaignId,
            seq.step_number,
            seq.delay_days,
            seq.subject_template,
            seq.body_template,
            seq.condition || 'no_open'
          ]);
        }
      } catch (e) {
        console.error('Failed to parse sequences:', e);
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      ...campaign,
      validLeads: parseResult.validRows,
      invalidLeads: parseResult.invalidRows,
      parseErrors: parseResult.errors,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Create campaign error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/campaigns/import-jarvis - Import leads directly from Jarvis Core API
router.post('/import-jarvis', async (req, res) => {
  const client = await (await getDb()).connect();
  try {
    const { name, verticalName, minScore, sequences } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });

    const jarvisUrl = new URL('http://localhost:3005/api/leads/qualified');
    if (verticalName) jarvisUrl.searchParams.append('verticalName', verticalName);
    if (minScore) jarvisUrl.searchParams.append('minScore', minScore);

    const fetch = (await import('node-fetch')).default || global.fetch;
    const response = await fetch(jarvisUrl.toString());
    
    if (!response.ok) {
      throw new Error(`Jarvis API Error: ${response.statusText}`);
    }

    const { leads: jarvisLeads } = await response.json();

    if (!jarvisLeads || jarvisLeads.length === 0) {
      return res.status(400).json({ error: 'No qualified leads found in Jarvis Core for these criteria.' });
    }

    const validLeads = jarvisLeads.filter(lead => lead.email && lead.email.trim() !== '');

    if (validLeads.length === 0) {
      return res.status(400).json({ error: 'Found leads in Jarvis, but none had valid email addresses.' });
    }

    await client.query('BEGIN');

    const campaignResult = await client.query(`
      INSERT INTO campaigns (name, total_leads) VALUES ($1, $2) RETURNING *
    `, [name, validLeads.length]);

    const campaign = campaignResult.rows[0];
    const campaignId = campaign.id;

    const pitchedJarvisIds = [];

    for (const lead of validLeads) {
      const trackingId = generateTrackingId();
      await client.query(`
        INSERT INTO leads (campaign_id, recipient_email, first_name, last_name, subject, body, tracking_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        campaignId,
        lead.email.trim(),
        lead.companyName || "there",
        lead.painPoint || "",
        "",
        "",
        trackingId
      ]);
      pitchedJarvisIds.push(lead.id);
    }

    if (sequences) {
      const seqs = typeof sequences === 'string' ? JSON.parse(sequences) : sequences;
      for (const seq of seqs) {
        await client.query(`
          INSERT INTO sequences (campaign_id, step_number, delay_days, subject_template, body_template, condition)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          campaignId,
          seq.step_number,
          seq.delay_days,
          seq.subject_template,
          seq.body_template,
          seq.condition || 'no_open'
        ]);
      }
    }

    await client.query('COMMIT');

    // Ping Jarvis
    if (pitchedJarvisIds.length > 0) {
      try {
        await fetch('http://localhost:3005/api/leads/pitch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: pitchedJarvisIds })
        });
      } catch (e) {
          console.error("Failed to mark leads pitched in Jarvis:", e.message);
      }
    }

    res.status(201).json({
      ...campaign,
      validLeads: validLeads.length,
      invalidLeads: jarvisLeads.length - validLeads.length,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Import Jarvis campaign error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/campaigns/:id/start - Start sending
router.post('/:id/start', async (req, res) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT * FROM campaigns WHERE id = $1', [req.params.id]);
    const campaign = result.rows[0];
    
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'active') return res.status(400).json({ error: 'Campaign is already active' });

    await queueCampaign(campaign.id);
    res.json({ message: 'Campaign started', status: 'active' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/:id/pause - Pause sending
router.post('/:id/pause', async (req, res) => {
  try {
    await pauseCampaign(parseInt(req.params.id));
    res.json({ message: 'Campaign paused', status: 'paused' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/:id/resume - Resume sending
router.post('/:id/resume', async (req, res) => {
  try {
    await resumeCampaign(parseInt(req.params.id));
    res.json({ message: 'Campaign resumed', status: 'active' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/:id/schedule-followups - Schedule follow-up sequences
router.post('/:id/schedule-followups', async (req, res) => {
  try {
    await scheduleFollowUps(parseInt(req.params.id));
    res.json({ message: 'Follow-ups scheduled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/:id/retry-failed - Retry failed emails
router.post('/:id/retry-failed', async (req, res) => {
  try {
    const db = await getDb();
    const id = req.params.id;
    
    const result = await db.query(`
      UPDATE leads SET status = 'pending', retry_count = 0, error_message = NULL
      WHERE campaign_id = $1 AND status = 'failed'
    `, [id]);

    await db.query(`
      UPDATE campaigns SET failed_count = (
        SELECT COUNT(*) FROM leads WHERE campaign_id = campaigns.id AND status = 'failed'
      ) WHERE id = $1
    `, [id]);

    const campaignRes = await db.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (campaignRes.rows[0]) {
      await queueCampaign(parseInt(id));
    }

    res.json({ message: `Requeued ${result.rowCount} failed emails`, requeued: result.rowCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/campaigns/:id - Delete campaign
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    await db.query('DELETE FROM campaigns WHERE id = $1', [req.params.id]);
    res.json({ message: 'Campaign deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/campaigns/:id/sequences - Update sequences for a campaign
router.put('/:id/sequences', async (req, res) => {
  const client = await (await getDb()).connect();
  try {
    const { sequences } = req.body;
    const campaignId = req.params.id;

    if (!Array.isArray(sequences)) {
      return res.status(400).json({ error: 'sequences must be an array' });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM sequences WHERE campaign_id = $1', [campaignId]);

    for (const seq of sequences) {
      await client.query(`
        INSERT INTO sequences (campaign_id, step_number, delay_days, subject_template, body_template, condition)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        campaignId,
        seq.step_number,
        seq.delay_days,
        seq.subject_template,
        seq.body_template,
        seq.condition || 'no_open'
      ]);
    }

    await client.query('COMMIT');

    const updated = await client.query(`
      SELECT * FROM sequences WHERE campaign_id = $1 ORDER BY step_number ASC
    `, [campaignId]);

    res.json(updated.rows);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
