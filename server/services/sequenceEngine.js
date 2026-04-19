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
  sequenceCron = cron.schedule('*/30 * * * *', () => {
    processFollowUps();
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
function scheduleFollowUps(campaignId) {
  const db = getDb();

  // Get sequences for this campaign
  const sequences = db.prepare(`
    SELECT * FROM sequences WHERE campaign_id = ? AND is_active = 1 ORDER BY step_number ASC
  `).all(campaignId);

  if (sequences.length === 0) return;

  // Get all sent leads (initial sends completed)
  const sentLeads = db.prepare(`
    SELECT id, sent_at FROM leads WHERE campaign_id = ? AND status = 'sent'
  `).all(campaignId);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO sequence_log (lead_id, sequence_id, step_number, status, tracking_id, scheduled_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `);

  const scheduleAll = db.transaction(() => {
    for (const lead of sentLeads) {
      let cumulativeDelay = 0;

      for (const seq of sequences) {
        cumulativeDelay += seq.delay_days;

        // Check if already scheduled
        const existing = db.prepare(`
          SELECT id FROM sequence_log WHERE lead_id = ? AND sequence_id = ?
        `).get(lead.id, seq.id);

        if (existing) continue;

        const trackingId = generateTrackingId();
        const scheduledAt = new Date(new Date(lead.sent_at).getTime() + cumulativeDelay * 24 * 60 * 60 * 1000);

        insertStmt.run(lead.id, seq.id, seq.step_number, trackingId, scheduledAt.toISOString());
      }
    }
  });

  scheduleAll();
  console.log(`📋 Scheduled follow-ups for campaign ${campaignId}`);
}

/**
 * Process pending follow-ups that are due
 */
async function processFollowUps() {
  const db = getDb();
  const now = new Date().toISOString();

  // Get pending follow-ups that are due
  const pendingFollowUps = db.prepare(`
    SELECT sl.*, s.subject_template, s.body_template, s.condition,
           l.recipient_email, l.first_name, l.last_name, l.open_count, l.click_count,
           l.campaign_id
    FROM sequence_log sl
    JOIN sequences s ON s.id = sl.sequence_id
    JOIN leads l ON l.id = sl.lead_id
    WHERE sl.status = 'pending' AND sl.scheduled_at <= ?
    ORDER BY sl.scheduled_at ASC
    LIMIT 20
  `).all(now);

  if (pendingFollowUps.length === 0) return;

  console.log(`🔄 Processing ${pendingFollowUps.length} follow-up emails`);

  for (const followUp of pendingFollowUps) {
    // Check condition
    let shouldSend = true;

    if (followUp.condition === 'no_open' && followUp.open_count > 0) {
      shouldSend = false;
    }
    if (followUp.condition === 'no_click' && followUp.click_count > 0) {
      shouldSend = false;
    }

    if (!shouldSend) {
      db.prepare(`UPDATE sequence_log SET status = 'skipped' WHERE id = ?`).run(followUp.id);
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
      db.prepare(`
        UPDATE sequence_log SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(followUp.id);

      db.prepare(`
        INSERT INTO send_log (campaign_id, lead_id, sender_email, recipient_email, subject, status)
        VALUES (?, ?, ?, ?, ?, 'sent')
      `).run(followUp.campaign_id, followUp.lead_id, result.senderEmail, followUp.recipient_email, subject);

      console.log(`📨 Follow-up step ${followUp.step_number} sent to ${followUp.recipient_email}`);
    } else if (result.exhausted) {
      // All accounts at limit, will retry next cycle
      console.log('⏸️  Sender accounts exhausted, will retry follow-ups later');
      break;
    } else {
      db.prepare(`
        UPDATE sequence_log SET status = 'failed' WHERE id = ?
      `).run(followUp.id);
      console.log(`❌ Follow-up failed: ${followUp.recipient_email} - ${result.error}`);
    }

    // Add delay between follow-up sends (30-60 seconds)
    await new Promise(resolve => setTimeout(resolve, 30000 + Math.random() * 30000));
  }
}

/**
 * Replace template variables with actual values
 */
function personalizeTemplate(template, data) {
  return template
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
