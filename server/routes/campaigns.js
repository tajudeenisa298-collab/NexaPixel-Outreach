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
router.get('/', (req, res) => {
  const db = getDb();
  const campaigns = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM leads WHERE campaign_id = c.id) as lead_count,
      (SELECT COUNT(*) FROM leads WHERE campaign_id = c.id AND status = 'sent') as actual_sent,
      (SELECT COUNT(*) FROM leads WHERE campaign_id = c.id AND status = 'queued') as queued_count,
      (SELECT COUNT(*) FROM leads WHERE campaign_id = c.id AND status = 'failed') as actual_failed
    FROM campaigns c
    ORDER BY c.created_at DESC
  `).all();
  res.json(campaigns);
});

// GET /api/campaigns/:id - Get campaign detail
router.get('/:id', (req, res) => {
  const db = getDb();
  const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const leads = db.prepare(`
    SELECT id, recipient_email, first_name, last_name, subject, status, sent_at,
           sender_email, tracking_id, open_count, click_count, last_opened_at, last_clicked_at, error_message
    FROM leads WHERE campaign_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id);

  const sequences = db.prepare(`
    SELECT * FROM sequences WHERE campaign_id = ? ORDER BY step_number ASC
  `).all(req.params.id);

  res.json({ ...campaign, leads, sequences });
});

// POST /api/campaigns/preview - Parse file and return stats/preview without saving
router.post('/preview', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV/XLSX file is required' });

    // Parse the uploaded file
    const parseResult = parseLeadFile(req.file.path, req.file.originalname);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.errors.join('; ') });
    }

    // Return early preview data
    res.json({
      totalRows: parseResult.totalRows,
      validRows: parseResult.validRows,
      invalidRows: parseResult.invalidRows,
      preview: parseResult.leads.slice(0, 5), // Return first 5 valid leads for preview
      errors: parseResult.errors.slice(0, 10), // Return max 10 errors
    });
  } catch (error) {
    console.error('Preview campaign error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns - Create campaign with file upload
router.post('/', upload.single('file'), (req, res) => {
  try {
    const db = getDb();
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });
    if (!req.file) return res.status(400).json({ error: 'CSV/XLSX file is required' });

    // Parse the uploaded file
    const parseResult = parseLeadFile(req.file.path, req.file.originalname);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.errors.join('; ') });
    }

    if (parseResult.leads.length === 0) {
      return res.status(400).json({ error: 'No valid leads found in file' });
    }

    // Create campaign
    const campaignResult = db.prepare(`
      INSERT INTO campaigns (name, total_leads) VALUES (?, ?)
    `).run(name, parseResult.validRows);

    const campaignId = campaignResult.lastInsertRowid;

    // Insert leads
    const insertLead = db.prepare(`
      INSERT INTO leads (campaign_id, recipient_email, first_name, last_name, subject, body, tracking_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction((leads) => {
      for (const lead of leads) {
        const trackingId = generateTrackingId();
        insertLead.run(
          campaignId,
          lead.recipient_email,
          lead.first_name,
          lead.last_name,
          lead.subject,
          lead.body,
          trackingId
        );
      }
    });

    insertAll(parseResult.leads);

    // Parse and save sequences if provided
    if (req.body.sequences) {
      try {
        const sequences = JSON.parse(req.body.sequences);
        const insertSeq = db.prepare(`
          INSERT INTO sequences (campaign_id, step_number, delay_days, subject_template, body_template, condition)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const seq of sequences) {
          insertSeq.run(
            campaignId,
            seq.step_number,
            seq.delay_days,
            seq.subject_template,
            seq.body_template,
            seq.condition || 'no_open'
          );
        }
      } catch (e) {
        console.error('Failed to parse sequences:', e);
      }
    }

    const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(campaignId);

    res.status(201).json({
      ...campaign,
      validLeads: parseResult.validRows,
      invalidLeads: parseResult.invalidRows,
      parseErrors: parseResult.errors,
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/import-jarvis - Import leads directly from Jarvis Core API
router.post('/import-jarvis', async (req, res) => {
  try {
    const db = getDb();
    const { name, verticalName, minScore, sequences } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name is required' });

    // 1. Fetch from Jarvis Core Mega-Database
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

    // Filter leads that have valid emails
    const validLeads = jarvisLeads.filter(lead => lead.email && lead.email.trim() !== '');

    if (validLeads.length === 0) {
      return res.status(400).json({ error: 'Found leads in Jarvis, but none had valid email addresses.' });
    }

    // 2. Create the campaign
    const campaignResult = db.prepare(`
      INSERT INTO campaigns (name, total_leads) VALUES (?, ?)
    `).run(name, validLeads.length);

    const campaignId = campaignResult.lastInsertRowid;

    // 3. Insert leads. We assign pain_point context into last_name for templates!
    const insertLead = db.prepare(`
      INSERT INTO leads (campaign_id, recipient_email, first_name, last_name, subject, body, tracking_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const pitchedJarvisIds = [];

    const insertAll = db.transaction((leads) => {
      for (const lead of leads) {
        const trackingId = generateTrackingId();
        
        insertLead.run(
          campaignId,
          lead.email.trim(),
          lead.companyName || "there",
          lead.painPoint || "", // Template magic: {{last_name}} becomes the First Line Intercept!
          "",
          "",
          trackingId
        );
        pitchedJarvisIds.push(lead.id);
      }
    });

    insertAll(validLeads);

    // 4. Save sequences
    if (sequences) {
      try {
        const seqs = typeof sequences === 'string' ? JSON.parse(sequences) : sequences;
        const insertSeq = db.prepare(`
          INSERT INTO sequences (campaign_id, step_number, delay_days, subject_template, body_template, condition)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const seq of seqs) {
          insertSeq.run(
            campaignId,
            seq.step_number,
            seq.delay_days,
            seq.subject_template,
            seq.body_template,
            seq.condition || 'no_open'
          );
        }
      } catch (e) {
        console.error('Failed to parse sequences:', e);
      }
    }

    // 5. Ping Jarvis to mark CONTACTED
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

    const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(campaignId);

    res.status(201).json({
      ...campaign,
      validLeads: validLeads.length,
      invalidLeads: jarvisLeads.length - validLeads.length,
    });
  } catch (error) {
    console.error('Import Jarvis campaign error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns/:id/start - Start sending
router.post('/:id/start', (req, res) => {
  const db = getDb();
  const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'active') return res.status(400).json({ error: 'Campaign is already active' });

  queueCampaign(campaign.id);

  res.json({ message: 'Campaign started', status: 'active' });
});

// POST /api/campaigns/:id/pause - Pause sending
router.post('/:id/pause', (req, res) => {
  pauseCampaign(parseInt(req.params.id));
  res.json({ message: 'Campaign paused', status: 'paused' });
});

// POST /api/campaigns/:id/resume - Resume sending
router.post('/:id/resume', (req, res) => {
  resumeCampaign(parseInt(req.params.id));
  res.json({ message: 'Campaign resumed', status: 'active' });
});

// POST /api/campaigns/:id/schedule-followups - Schedule follow-up sequences
router.post('/:id/schedule-followups', (req, res) => {
  scheduleFollowUps(parseInt(req.params.id));
  res.json({ message: 'Follow-ups scheduled' });
});

// POST /api/campaigns/:id/retry-failed - Retry failed emails
router.post('/:id/retry-failed', (req, res) => {
  const db = getDb();
  
  const result = db.prepare(`
    UPDATE leads SET status = 'pending', retry_count = 0, error_message = NULL
    WHERE campaign_id = ? AND status = 'failed'
  `).run(req.params.id);

  db.prepare(`
    UPDATE campaigns SET failed_count = (
      SELECT COUNT(*) FROM leads WHERE campaign_id = campaigns.id AND status = 'failed'
    ) WHERE id = ?
  `).run(req.params.id);

  const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(req.params.id);
  if (campaign) {
    queueCampaign(parseInt(req.params.id));
  }

  res.json({ message: `Requeued ${result.changes} failed emails`, requeued: result.changes });
});

// DELETE /api/campaigns/:id - Delete campaign
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(req.params.id);
  res.json({ message: 'Campaign deleted' });
});

// PUT /api/campaigns/:id/sequences - Update sequences for a campaign
router.put('/:id/sequences', (req, res) => {
  const db = getDb();
  const { sequences } = req.body;

  if (!Array.isArray(sequences)) {
    return res.status(400).json({ error: 'sequences must be an array' });
  }

  // Remove existing sequences
  db.prepare(`DELETE FROM sequences WHERE campaign_id = ?`).run(req.params.id);

  // Insert new sequences
  const insertSeq = db.prepare(`
    INSERT INTO sequences (campaign_id, step_number, delay_days, subject_template, body_template, condition)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const seq of sequences) {
      insertSeq.run(
        req.params.id,
        seq.step_number,
        seq.delay_days,
        seq.subject_template,
        seq.body_template,
        seq.condition || 'no_open'
      );
    }
  });

  insertAll();

  const updated = db.prepare(`
    SELECT * FROM sequences WHERE campaign_id = ? ORDER BY step_number ASC
  `).all(req.params.id);

  res.json(updated);
});

module.exports = router;
