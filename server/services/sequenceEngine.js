const cron = require('node-cron');
const { getDb } = require('../db/database');
const { sendWithRotation } = require('./senderRotation');
const { generateTrackingId, prepareEmailBody } = require('./trackingService');

let sequenceCron = null;

/**
 * Start the sequence engine cron job
 * Runs every 30 minutes to check for pending follow-ups
 */
function startSequenceEngine() {
  if (sequenceCron) return;

  // Run every 30 minutes
  sequenceCron = cron.schedule('*/30 * * * *', async () => {
    try {
      await processFollowUps();
    } catch (err) {
      console.error('Sequence engine execution error:', err.message);
    }
  });

  console.log('🔄 Sequence engine started (checking every 30 minutes)');
}

/**
 * Stop the sequence engine
 */
function stopSequenceEngine() {
  if (sequenceCron) {
    sequenceCron.stop();
    sequenceCron = null;
  }
}

/**
 * Schedule follow-ups for a campaign's leads after initial send
 */
async function scheduleFollowUps(campaignId) {
  try {
    const db = await getDb();
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Get sequences for this campaign
      const seqRes = await client.query(`
        SELECT * FROM sequences WHERE campaign_id = $1 AND is_active = 1 ORDER BY step_number ASC
      `, [campaignId]);
      const sequences = seqRes.rows;

      if (sequences.length === 0) {
        await client.query('COMMIT');
        return;
      }

      // Get all sent leads
      const leadsRes = await client.query(`
        SELECT id, sent_at FROM leads WHERE campaign_id = $1 AND status = 'sent'
      `, [campaignId]);
      const sentLeads = leadsRes.rows;

      for (const lead of sentLeads) {
        let cumulativeDelay = 0;

        for (const seq of sequences) {
          cumulativeDelay += parseInt(seq.delay_days);

          // Check if already scheduled (manual ON CONFLICT alternative)
          const existingRes = await client.query(`
            SELECT id FROM sequence_log WHERE lead_id = $1 AND sequence_id = $2
          `, [lead.id, seq.id]);

          if (existingRes.rowCount > 0) continue;

          const trackingId = generateTrackingId();
          // Postgres can handle ISO strings directly in TIMESTAMP columns
          const scheduledAt = new Date(new Date(lead.sent_at).getTime() + cumulativeDelay * 24 * 60 * 60 * 1000);

          await client.query(`
            INSERT INTO sequence_log (lead_id, sequence_id, step_number, status, tracking_id, scheduled_at)
            VALUES ($1, $2, $3, 'pending', $4, $5)
            ON CONFLICT DO NOTHING
          `, [lead.id, seq.id, seq.step_number, trackingId, scheduledAt.toISOString()]);
        }
      }

      await client.query('COMMIT');
      console.log(`📋 Scheduled follow-ups for campaign ${campaignId}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Schedule follow-ups error:', err.message);
  }
}

/**
 * Process pending follow-ups that are due
 */
async function processFollowUps() {
  try {
    const db = await getDb();
    const now = new Date().toISOString();

    // Get pending follow-ups that are due
    const pendingRes = await db.query(`
      SELECT sl.*, s.subject_template, s.body_template, s.condition,
             l.recipient_email, l.first_name, l.last_name, l.open_count, l.click_count,
             l.campaign_id
      FROM sequence_log sl
      JOIN sequences s ON s.id = sl.sequence_id
      JOIN leads l ON l.id = sl.lead_id
      WHERE sl.status = 'pending' AND sl.scheduled_at <= $1
      ORDER BY sl.scheduled_at ASC
      LIMIT 20
    `, [now]);
    
    const pendingFollowUps = pendingRes.rows;

    if (pendingFollowUps.length === 0) return;

    console.log(`🔄 Processing ${pendingFollowUps.length} follow-up emails`);

    for (const followUp of pendingFollowUps) {
      // Check condition
      let shouldSend = true;

      const openCount = parseInt(followUp.open_count || 0);
      const clickCount = parseInt(followUp.click_count || 0);

      if (followUp.condition === 'no_open' && openCount > 0) {
        shouldSend = false;
      }
      if (followUp.condition === 'no_click' && clickCount > 0) {
        shouldSend = false;
      }

      if (!shouldSend) {
        await db.query(`UPDATE sequence_log SET status = 'skipped' WHERE id = $1`, [followUp.id]);
        continue;
      }

      // Personalize the template
      const subject = personalizeTemplate(followUp.subject_template, followUp);
      const body = personalizeTemplate(followUp.body_template, followUp);
      const htmlBody = prepareEmailBody(body, followUp.tracking_id);

      // Send the follow-up
      const result = await sendWithRotation({
        to: followUp.recipient_email,
        toName: `${followUp.first_name || ''} ${followUp.last_name || ''}`.trim(),
        subject: subject,
        text: body,
        html: htmlBody,
      });

      if (result.success) {
        await db.query(`
          UPDATE sequence_log SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = $1
        `, [followUp.id]);

        await db.query(`
          INSERT INTO send_log (campaign_id, lead_id, sender_email, recipient_email, subject, status)
          VALUES ($1, $2, $3, $4, $5, 'sent')
        `, [followUp.campaign_id, followUp.lead_id, result.senderEmail, followUp.recipient_email, subject]);

        console.log(`📨 Follow-up step ${followUp.step_number} sent to ${followUp.recipient_email}`);
      } else if (result.exhausted) {
        console.log('⏸️  Sender accounts exhausted, will retry follow-ups later');
        break;
      } else {
        await db.query(`
          UPDATE sequence_log SET status = 'failed' WHERE id = $1
        `, [followUp.id]);
        console.log(`❌ Follow-up failed: ${followUp.recipient_email} - ${result.error}`);
      }

      // Add delay between follow-up sends (30-60 seconds)
      await new Promise(resolve => setTimeout(resolve, 30000 + Math.random() * 30000));
    }
  } catch (err) {
    console.error('Process follow-ups error:', err.message);
  }
}

/**
 * Replace template variables with actual values
 */
function personalizeTemplate(template, data) {
  return (template || '')
    .replace(/\{\{first_name\}\}/gi, data.first_name || '')
    .replace(/\{\{last_name\}\}/gi, data.last_name || '')
    .replace(/\{\{email\}\}/gi, data.recipient_email || '')
    .replace(/\{\{full_name\}\}/gi, `${data.first_name || ''} ${data.last_name || ''}`.trim());
}

module.exports = {
  startSequenceEngine,
  stopSequenceEngine,
  scheduleFollowUps,
  processFollowUps,
};
