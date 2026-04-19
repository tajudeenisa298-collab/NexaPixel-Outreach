const { getDb } = require('../db/database');
const { sendViaGmail } = require('./gmailSender');
const { sendViaBrevo } = require('./brevoSender');



let currentIndex = 0;

/**
 * Reset daily/hourly counters if needed
 */
function resetCountersIfNeeded() {
  const db = getDb();
  const now = new Date();

  // Reset daily counts (24 hours)
  db.prepare(`
    UPDATE sender_accounts
    SET daily_sent = 0, last_daily_reset = ?
    WHERE datetime(last_daily_reset, '+24 hours') < datetime(?)
  `).run(now.toISOString(), now.toISOString());

  // Reset hourly counts (1 hour)
  db.prepare(`
    UPDATE sender_accounts
    SET hourly_sent = 0, last_hourly_reset = ?
    WHERE datetime(last_hourly_reset, '+1 hour') < datetime(?)
  `).run(now.toISOString(), now.toISOString());
}

/**
 * Get the next available sender account (round-robin with limits)
 * @returns {Object|null} - sender account or null if all exhausted
 */
function getNextSender() {
  const db = getDb();
  resetCountersIfNeeded();

  const accounts = db.prepare(`
    SELECT * FROM sender_accounts
    WHERE is_active = 1
      AND is_paused = 0
      AND daily_sent < daily_limit
      AND hourly_sent < hourly_limit
    ORDER BY daily_sent ASC, last_used_at ASC NULLS FIRST
  `).all();

  if (accounts.length === 0) return null;

  // Round-robin: pick the account with the least sends
  const account = accounts[0];
  return account;
}

/**
 * Record that a send was made from a specific account
 */
function recordSend(accountId) {
  const db = getDb();
  db.prepare(`
    UPDATE sender_accounts
    SET daily_sent = daily_sent + 1,
        hourly_sent = hourly_sent + 1,
        last_used_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(accountId);
}

/**
 * Record an error for a specific account
 */
function recordError(accountId, errorMessage) {
  const db = getDb();
  
  const isCritical = errorMessage && (
    errorMessage.includes('534') || 
    errorMessage.includes('Invalid login') || 
    errorMessage.includes('blocked') ||
    errorMessage.includes('Rate limit') ||
    errorMessage.includes('Credentials not found')
  );

  db.prepare(`
    UPDATE sender_accounts
    SET last_error = ?, 
        is_active = CASE 
          WHEN ? THEN 0 
          WHEN daily_sent > daily_limit THEN 0 
          ELSE is_active 
        END
    WHERE id = ?
  `).run(errorMessage, isCritical ? 1 : 0, accountId);
}

/**
 * Send an email using the rotation engine
 * @param {Object} emailData - { to, toName, subject, text, html }
 * @returns {Promise<Object>} - { success, senderEmail, messageId, error }
 */
async function sendWithRotation(emailData) {
  let sender = getNextSender();
  
  let attempts = 0;
  
  while (sender && attempts < 3) {
    attempts++;
    let result;

    if (sender.type === 'gmail' || sender.type === 'outlook' || sender.type === 'zoho' || sender.type === 'smtp') {
      if (!sender.password) {
        recordError(sender.id, 'Credentials not found in database');
        sender = getNextSender();
        continue;
      }

      result = await sendViaGmail(
        { email: sender.email, password: sender.password, displayName: sender.display_name, type: sender.type },
        emailData
      );
    } else if (sender.type === 'brevo') {
      if (!sender.password) {
        recordError(sender.id, 'Brevo API key not found in database');
        sender = getNextSender();
        continue;
      }

      result = await sendViaBrevo(
        { email: sender.email, apiKey: sender.password, name: sender.display_name },
        emailData
      );
    }

    if (result.success) {
      recordSend(sender.id);
      return {
        success: true,
        senderEmail: sender.email,
        senderType: sender.type,
        messageId: result.messageId,
      };
    } else {
      recordError(sender.id, result.error);
      
      const isCritical = result.error && (
        result.error.includes('534') || 
        result.error.includes('Invalid login') || 
        result.error.includes('blocked') ||
        result.error.includes('Rate limit') ||
        result.error.includes('Credentials not found')
      );

      if (isCritical) {
        console.log(`⚠️ Sender ${sender.email} failed with critical error. Trying another sender...`);
        sender = getNextSender();
      } else {
        return {
          success: false,
          senderEmail: sender.email,
          error: result.error,
        };
      }
    }
  }

  if (!sender) {
    return {
      success: false,
      error: 'All sender accounts have reached limits or are temporarily disabled.',
      exhausted: true,
    };
  }

  return {
    success: false,
    error: 'Tried multiple accounts but all encountered critical errors.',
  };
}

/**
 * Get status of all sender accounts
 */
function getAccountsStatus() {
  const db = getDb();
  resetCountersIfNeeded();
  return db.prepare(`
    SELECT id, email, type, display_name, daily_sent, daily_limit, hourly_sent, hourly_limit,
           is_active, is_paused, last_error, last_used_at, created_at
    FROM sender_accounts
    ORDER BY type, email
  `).all();
}

/**
 * Get total remaining capacity across all accounts
 */
function getRemainingCapacity() {
  const db = getDb();
  resetCountersIfNeeded();
  const result = db.prepare(`
    SELECT
      SUM(daily_limit - daily_sent) as remaining_daily,
      SUM(hourly_limit - hourly_sent) as remaining_hourly,
      COUNT(*) as total_accounts,
      SUM(CASE WHEN is_active = 1 AND is_paused = 0 AND daily_sent < daily_limit THEN 1 ELSE 0 END) as active_accounts
    FROM sender_accounts
    WHERE is_active = 1 AND is_paused = 0
  `).get();
  return result;
}

module.exports = {
  sendWithRotation,
  getNextSender,
  getAccountsStatus,
  getRemainingCapacity,
  resetCountersIfNeeded,
};
