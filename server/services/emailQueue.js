const { getDb } = require('../db/database');
const { sendWithRotation } = require('./senderRotation');
const { generateTrackingId, prepareEmailBody } = require('./trackingService');

let isProcessing = false;
let queueInterval = null;
let currentSendInterval = 35000; // Default: 35 seconds
const MAX_RETRIES = 3;

/**
 * Queue all pending leads for a campaign
 */
function queueCampaign(campaignId) {
  const db = getDb();

  // Generate tracking IDs for all pending leads
  const leads = db.prepare(`
    SELECT id FROM leads WHERE campaign_id = ? AND status = 'pending'
  `).all(campaignId);

  const updateStmt = db.prepare(`
    UPDATE leads SET status = 'queued', tracking_id = ? WHERE id = ?
  `);

  const queueAll = db.transaction(() => {
    for (const lead of leads) {
      const trackingId = generateTrackingId();
      updateStmt.run(trackingId, lead.id);
    }

    db.prepare(`
      UPDATE campaigns SET status = 'active', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(campaignId);
  });

  queueAll();
  console.log(`📧 Queued ${leads.length} leads for campaign ${campaignId}`);

  // Start processing if not already running
  startProcessing();
}

/**
 * Process the next email in the queue
 */
async function processNextEmail() {
  if (isProcessing) return;
  isProcessing = true;

  const db = getDb();

  try {
    // Get the next queued lead
    const lead = db.prepare(`
      SELECT l.*, c.name as campaign_name
      FROM leads l
      JOIN campaigns c ON c.id = l.campaign_id
      WHERE l.status = 'queued' AND c.status = 'active'
      ORDER BY l.created_at ASC
      LIMIT 1
    `).get();

    if (!lead) {
      // Check if any active campaigns remain
      const activeCampaigns = db.prepare(`
        SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'
      `).get();

      if (activeCampaigns.count === 0) {
        console.log('✅ All queued emails have been processed');
        stopProcessing();
      }
      isProcessing = false;
      return;
    }

    // Mark as sending
    db.prepare(`UPDATE leads SET status = 'sending' WHERE id = ?`).run(lead.id);

    // Prepare the email with tracking
    const htmlBody = prepareEmailBody(lead.body, lead.tracking_id);

    // Send with rotation
    const result = await sendWithRotation({
      to: lead.recipient_email,
      toName: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      subject: lead.subject,
      text: lead.body,
      html: htmlBody,
    });

    if (result.success) {
      // Mark as sent
      db.prepare(`
        UPDATE leads
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_via = ?, sender_email = ?
        WHERE id = ?
      `).run(result.senderType, result.senderEmail, lead.id);

      // Update campaign counters
      db.prepare(`
        UPDATE campaigns SET sent_count = sent_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(lead.campaign_id);

      // Log the send
      db.prepare(`
        INSERT INTO send_log (campaign_id, lead_id, sender_email, recipient_email, subject, status)
        VALUES (?, ?, ?, ?, ?, 'sent')
      `).run(lead.campaign_id, lead.id, result.senderEmail, lead.recipient_email, lead.subject);

      console.log(`✉️  Sent to ${lead.recipient_email} via ${result.senderEmail}`);
    } else if (result.exhausted) {
      // All accounts exhausted, put back to queued and pause
      db.prepare(`UPDATE leads SET status = 'queued' WHERE id = ?`).run(lead.id);
      console.log('⏸️  All sender accounts exhausted. Pausing queue...');
      // Don't stop - the resetCountersIfNeeded will re-enable accounts
    } else {
      // Send failed
      const retryCount = (lead.retry_count || 0) + 1;
      if (retryCount >= MAX_RETRIES) {
        db.prepare(`
          UPDATE leads SET status = 'failed', error_message = ?, retry_count = ? WHERE id = ?
        `).run(result.error, retryCount, lead.id);

        db.prepare(`
          UPDATE campaigns SET failed_count = failed_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(lead.campaign_id);

        db.prepare(`
          INSERT INTO send_log (campaign_id, lead_id, sender_email, recipient_email, subject, status, error_message)
          VALUES (?, ?, ?, ?, ?, 'failed', ?)
        `).run(lead.campaign_id, lead.id, result.senderEmail || 'unknown', lead.recipient_email, lead.subject, result.error);
      } else {
        // Retry later
        db.prepare(`
          UPDATE leads SET status = 'queued', retry_count = ?, error_message = ? WHERE id = ?
        `).run(retryCount, result.error, lead.id);
      }

      console.log(`❌ Failed: ${lead.recipient_email} - ${result.error}`);
    }

    // Check if campaign is complete
    checkCampaignCompletion(lead.campaign_id);

  } catch (error) {
    console.error('Queue processing error:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Check if all leads in a campaign have been processed
 */
function checkCampaignCompletion(campaignId) {
  const db = getDb();
  const remaining = db.prepare(`
    SELECT COUNT(*) as count FROM leads
    WHERE campaign_id = ? AND status IN ('pending', 'queued', 'sending')
  `).get(campaignId);

  if (remaining.count === 0) {
    db.prepare(`
      UPDATE campaigns SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(campaignId);
    console.log(`🎉 Campaign ${campaignId} completed!`);
  }
}

/**
 * Start the queue processing interval
 */
function startProcessing() {
  if (queueInterval) return;

  // Add a random jitter to the base interval
  queueInterval = setInterval(async () => {
    const jitter = Math.floor(Math.random() * 2000); // 0-2s jitter so it's not perfectly robotic
    await new Promise(resolve => setTimeout(resolve, jitter));
    await processNextEmail();
  }, currentSendInterval);

  // Process the first one immediately
  processNextEmail();
  console.log('🚀 Email queue processing started');
}

/**
 * Stop the queue processing
 */
function stopProcessing() {
  if (queueInterval) {
    clearInterval(queueInterval);
    queueInterval = null;
    console.log('⏹️  Email queue processing stopped');
  }
}

/**
 * Pause a campaign
 */
function pauseCampaign(campaignId) {
  const db = getDb();
  db.prepare(`UPDATE campaigns SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(campaignId);
  // Put sending leads back to queued
  db.prepare(`UPDATE leads SET status = 'queued' WHERE campaign_id = ? AND status = 'sending'`).run(campaignId);

  // Check if any other active campaigns exist
  const active = db.prepare(`SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'`).get();
  if (active.count === 0) {
    stopProcessing();
  }
}

/**
 * Resume a paused campaign
 */
function resumeCampaign(campaignId) {
  const db = getDb();
  db.prepare(`UPDATE campaigns SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(campaignId);
  
  // Also queue any stray pending leads just in case they were left behind by a crash
  queueCampaign(campaignId);
}

/**
 * Get queue status
 */
function getQueueStatus() {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      COUNT(*) as total
    FROM leads
  `).get();

  return {
    ...stats,
    isProcessing: !!queueInterval,
    sendInterval: currentSendInterval,
  };
}

/**
 * Load settings from database
 */
function loadSettings() {
  try {
    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'send_interval'").get();
    if (setting) {
      currentSendInterval = parseInt(setting.value);
      console.log(`⚙️ Loaded Send Interval: ${currentSendInterval}ms`);
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

/**
 * Update the send interval and restart the queue if necessary
 */
function updateSendInterval(ms) {
  const db = getDb();
  currentSendInterval = parseInt(ms);
  
  // Persist to DB
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('send_interval', ?)").run(ms.toString());
  
  console.log(`⚙️ Send interval updated to: ${ms}ms`);

  // If the queue is running, we need to restart it to pick up the new interval
  if (queueInterval) {
    stopProcessing();
    startProcessing();
  }
}

/**
 * On server start, resume any active campaigns
 */
function resumeOnStartup() {
  const db = getDb();
  const active = db.prepare(`SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'`).get();
  if (active.count > 0) {
    console.log(`📫 Resuming ${active.count} active campaign(s) from previous session`);
    startProcessing();
  }
}

module.exports = {
  queueCampaign,
  processNextEmail,
  startProcessing,
  stopProcessing,
  pauseCampaign,
  resumeCampaign,
  getQueueStatus,
  resumeOnStartup,
  loadSettings,
  updateSendInterval,
};
