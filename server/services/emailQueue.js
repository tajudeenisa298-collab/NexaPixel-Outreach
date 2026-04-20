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
async function queueCampaign(campaignId) {
  try {
    const db = await getDb();
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Get pending leads
      const leadsRes = await client.query(`
        SELECT id FROM leads WHERE campaign_id = $1 AND status = 'pending'
      `, [campaignId]);
      const leads = leadsRes.rows;

      for (const lead of leads) {
        const trackingId = generateTrackingId();
        await client.query(`
          UPDATE leads SET status = 'queued', tracking_id = $1 WHERE id = $2
        `, [trackingId, lead.id]);
      }

      await client.query(`
        UPDATE campaigns SET status = 'active', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [campaignId]);

      await client.query('COMMIT');
      console.log(`📧 Queued ${leads.length} leads for campaign ${campaignId}`);

      // Start processing if not already running
      startProcessing();
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Queue campaign error:', err.message);
  }
}

/**
 * Process the next email in the queue
 */
async function processNextEmail() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Safety watchdog: prevent infinite lock
    const lockTimeout = setTimeout(() => {
      if (isProcessing) {
        console.warn('⚠️ Queue lock timeout reached. Releasing lock.');
        isProcessing = false;
      }
    }, 120000); // 2 minute emergency release

    const db = await getDb();

    // Get the next queued lead
    const leadRes = await db.query(`
      SELECT l.*, c.name as campaign_name
      FROM leads l
      JOIN campaigns c ON c.id = l.campaign_id
      WHERE l.status = 'queued' AND c.status = 'active'
      ORDER BY l.created_at ASC
      LIMIT 1
    `);
    const lead = leadRes.rows[0];

    if (!lead) {
      // Check if any active campaigns remain
      const activeCampaignsRes = await db.query(`
        SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'
      `);
      const activeCount = parseInt(activeCampaignsRes.rows[0].count);

      if (activeCount === 0) {
        console.log('✅ All queued emails have been processed');
        stopProcessing();
      }
      isProcessing = false;
      return;
    }

    // Mark as sending
    await db.query(`UPDATE leads SET status = 'sending' WHERE id = $1`, [lead.id]);

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
      await db.query(`
        UPDATE leads
        SET status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_via = $1, sender_email = $2
        WHERE id = $3
      `, [result.senderType, result.senderEmail, lead.id]);

      // Update campaign counters
      await db.query(`
        UPDATE campaigns SET sent_count = sent_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1
      `, [lead.campaign_id]);

      // Log the send
      await db.query(`
        INSERT INTO send_log (campaign_id, lead_id, sender_email, recipient_email, subject, status)
        VALUES ($1, $2, $3, $4, $5, 'sent')
      `, [lead.campaign_id, lead.id, result.senderEmail, lead.recipient_email, lead.subject]);

      console.log(`✉️  Sent to ${lead.recipient_email} via ${result.senderEmail}`);
    } else if (result.exhausted) {
      // All accounts exhausted, put back to queued
      await db.query(`UPDATE leads SET status = 'queued' WHERE id = $1`, [lead.id]);
      console.log('⏸️  All sender accounts exhausted. Waiting for reset...');
    } else {
      // Send failed
      const retryCount = (parseInt(lead.retry_count) || 0) + 1;
      if (retryCount >= MAX_RETRIES) {
        await db.query(`
          UPDATE leads SET status = 'failed', error_message = $1, retry_count = $2 WHERE id = $3
        `, [result.error, retryCount, lead.id]);

        await db.query(`
          UPDATE campaigns SET failed_count = failed_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1
        `, [lead.campaign_id]);

        await db.query(`
          INSERT INTO send_log (campaign_id, lead_id, sender_email, recipient_email, subject, status, error_message)
          VALUES ($1, $2, $3, $4, $5, 'failed', $6)
        `, [lead.campaign_id, lead.id, result.senderEmail || 'unknown', lead.recipient_email, lead.subject, result.error]);
      } else {
        // Retry later
        await db.query(`
          UPDATE leads SET status = 'queued', retry_count = $1, error_message = $2 WHERE id = $3
        `, [retryCount, result.error, lead.id]);
      }

      console.log(`❌ Failed: ${lead.recipient_email} - ${result.error}`);
    }

    // Check if campaign is complete
    await checkCampaignCompletion(lead.campaign_id);

  } catch (error) {
    console.error('Queue processing error:', error);
  } finally {
    if (typeof lockTimeout !== 'undefined') clearTimeout(lockTimeout);
    isProcessing = false;
  }
}

/**
 * Check if all leads in a campaign have been processed
 */
async function checkCampaignCompletion(campaignId) {
  try {
    const db = await getDb();
    const res = await db.query(`
      SELECT COUNT(*) as count FROM leads
      WHERE campaign_id = $1 AND status IN ('pending', 'queued', 'sending')
    `, [campaignId]);

    if (parseInt(res.rows[0].count) === 0) {
      await db.query(`
        UPDATE campaigns SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [campaignId]);
      console.log(`🎉 Campaign ${campaignId} completed!`);
    }
  } catch (e) {
    console.error('Check completion error:', e.message);
  }
}

/**
 * Start the queue processing interval
 */
function startProcessing() {
  if (queueInterval) return;

  queueInterval = setInterval(async () => {
    const jitter = Math.floor(Math.random() * 2000);
    await new Promise(resolve => setTimeout(resolve, jitter));
    await processNextEmail();
  }, currentSendInterval);

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
async function pauseCampaign(campaignId) {
  try {
    const db = await getDb();
    await db.query(`UPDATE campaigns SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [campaignId]);
    await db.query(`UPDATE leads SET status = 'queued' WHERE campaign_id = $1 AND status = 'sending'`, [campaignId]);

    const activeRes = await db.query(`SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'`);
    if (parseInt(activeRes.rows[0].count) === 0) {
      stopProcessing();
    }
  } catch (e) {
    console.error('Pause campaign error:', e.message);
  }
}

/**
 * Resume a paused campaign
 */
async function resumeCampaign(campaignId) {
  try {
    const db = await getDb();
    await db.query(`UPDATE campaigns SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [campaignId]);
    await queueCampaign(campaignId);
  } catch (e) {
    console.error('Resume campaign error:', e.message);
  }
}

/**
 * Get queue status
 */
async function getQueueStatus() {
  try {
    const db = await getDb();
    const statsRes = await db.query(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total
      FROM leads
    `);
    const stats = statsRes.rows[0];

    return {
      ...stats,
      isProcessing: !!queueInterval,
      sendInterval: currentSendInterval,
    };
  } catch (e) {
    return { isProcessing: !!queueInterval, sendInterval: currentSendInterval };
  }
}

/**
 * Load settings from database
 */
async function loadSettings() {
  try {
    const db = await getDb();
    const res = await db.query("SELECT value FROM settings WHERE key = 'send_interval'");
    if (res.rows[0]) {
      currentSendInterval = parseInt(res.rows[0].value);
      console.log(`⚙️ Loaded Send Interval: ${currentSendInterval}ms`);
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

/**
 * Update the send interval
 */
async function updateSendInterval(ms) {
  try {
    const db = await getDb();
    currentSendInterval = parseInt(ms);
    
    await db.query(`
      INSERT INTO settings (key, value) VALUES ('send_interval', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [ms.toString()]);
    
    console.log(`⚙️ Send interval updated to: ${ms}ms`);

    if (queueInterval) {
      stopProcessing();
      startProcessing();
    }
  } catch (err) {
    console.error('Update interval error:', err.message);
  }
}

/**
 * On server start, resume any active campaigns
 */
async function resumeOnStartup() {
  try {
    const db = await getDb();
    
    // Reset any leads that were stuck in SENDING (server crashed or hung)
    const resetRes = await db.query("UPDATE leads SET status = 'queued' WHERE status = 'sending'");
    if (resetRes.rowCount > 0) {
      console.log(`📡 Reset ${resetRes.rowCount} stuck 'SENDING' leads back to queue`);
    }

    const res = await db.query(`SELECT COUNT(*) as count FROM campaigns WHERE status = 'active'`);
    if (parseInt(res.rows[0].count) > 0) {
      console.log(`📫 Resuming ${res.rows[0].count} active campaign(s) from previous session`);
      startProcessing();
    }
  } catch (e) {
    console.error('Resume on startup error:', e.message);
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
