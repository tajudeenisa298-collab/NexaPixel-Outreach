const { getDb } = require('../db/database');
const { sendViaGmail } = require('./gmailSender');
const { sendViaBrevo } = require('./brevoSender');

/**
 * Reset daily/hourly counters if needed using Postgres timestamp logic
 */
async function resetCountersIfNeeded() {
  try {
    const db = await getDb();
    
    // Reset daily counts (24 hours)
    await db.query(`
      UPDATE sender_accounts
      SET daily_sent = 0, last_daily_reset = CURRENT_TIMESTAMP
      WHERE last_daily_reset < NOW() - INTERVAL '24 hours'
    `);

    // Reset hourly counts (1 hour)
    await db.query(`
      UPDATE sender_accounts
      SET hourly_sent = 0, last_hourly_reset = CURRENT_TIMESTAMP
      WHERE last_hourly_reset < NOW() - INTERVAL '1 hour'
    `);
  } catch (e) {
    console.error('Reset counters error:', e.message);
  }
}

/**
 * Get the next available sender account (round-robin with limits)
 * @returns {Promise<Object|null>} - sender account or null if all exhausted
 */
async function getNextSender() {
  try {
    const db = await getDb();
    await resetCountersIfNeeded();

    const res = await db.query(`
      SELECT * FROM sender_accounts
      WHERE is_active = 1
        AND is_paused = 0
        AND daily_sent < daily_limit
        AND hourly_sent < hourly_limit
      ORDER BY daily_sent ASC, last_used_at ASC NULLS FIRST
      LIMIT 1
    `);

    return res.rows[0] || null;
  } catch (e) {
    console.error('Get next sender error:', e.message);
    return null;
  }
}

/**
 * Record that a send was made from a specific account
 */
async function recordSend(accountId) {
  try {
    const db = await getDb();
    await db.query(`
      UPDATE sender_accounts
      SET daily_sent = daily_sent + 1,
          hourly_sent = hourly_sent + 1,
          last_used_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [accountId]);
  } catch (e) {
    console.error('Record send error:', e.message);
  }
}

/**
 * Record an error for a specific account
 */
async function recordError(accountId, errorMessage) {
  try {
    const db = await getDb();
    
    const isCritical = errorMessage && (
      errorMessage.includes('534') || 
      errorMessage.includes('Invalid login') || 
      errorMessage.includes('blocked') ||
      errorMessage.includes('Rate limit') ||
      errorMessage.includes('Credentials not found')
    );

    await db.query(`
      UPDATE sender_accounts
      SET last_error = $1, 
          is_active = CASE 
            WHEN $2 = true THEN 0 
            WHEN daily_sent >= daily_limit THEN 0 
            ELSE is_active 
          END
      WHERE id = $3
    `, [errorMessage, isCritical, accountId]);
  } catch (e) {
    console.error('Record error error:', e.message);
  }
}

/**
 * Send an email using the rotation engine
 * @param {Object} emailData - { to, toName, subject, text, html }
 * @returns {Promise<Object>} - { success, senderEmail, messageId, error }
 */
async function sendWithRotation(emailData) {
  let sender = await getNextSender();
  let attempts = 0;
  
  while (sender && attempts < 3) {
    attempts++;
    let result;

    if (sender.type === 'gmail' || sender.type === 'outlook' || sender.type === 'zoho' || sender.type === 'smtp') {
      if (!sender.password) {
        await recordError(sender.id, 'Credentials not found in database');
        sender = await getNextSender();
        continue;
      }

      result = await sendViaGmail(
        { email: sender.email, password: sender.password, displayName: sender.display_name, type: sender.type },
        emailData
      );
    } else if (sender.type === 'brevo') {
      if (!sender.password) {
        await recordError(sender.id, 'Brevo API key not found in database');
        sender = await getNextSender();
        continue;
      }

      result = await sendViaBrevo(
        { email: sender.email, apiKey: sender.password, name: sender.display_name },
        emailData
      );
    }

    if (result.success) {
      await recordSend(sender.id);
      return {
        success: true,
        senderEmail: sender.email,
        senderType: sender.type,
        messageId: result.messageId,
      };
    } else {
      await recordError(sender.id, result.error);
      
      const isCritical = result.error && (
        result.error.includes('534') || 
        result.error.includes('Invalid login') || 
        result.error.includes('blocked') ||
        result.error.includes('Rate limit') ||
        result.error.includes('Credentials not found')
      );

      if (isCritical) {
        console.log(`⚠️ Sender ${sender.email} failed with critical error. Trying another sender...`);
        sender = await getNextSender();
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
async function getAccountsStatus() {
  try {
    const db = await getDb();
    await resetCountersIfNeeded();
    const res = await db.query(`
      SELECT id, email, type, display_name, daily_sent, daily_limit, hourly_sent, hourly_limit,
             is_active, is_paused, last_error, last_used_at, created_at
      FROM sender_accounts
      ORDER BY type, email
    `);
    return res.rows;
  } catch (e) {
    console.error('Get accounts status error:', e.message);
    return [];
  }
}

/**
 * Get total remaining capacity across all accounts
 */
async function getRemainingCapacity() {
  try {
    const db = await getDb();
    await resetCountersIfNeeded();
    const res = await db.query(`
      SELECT
        SUM(daily_limit - daily_sent) as remaining_daily,
        SUM(hourly_limit - hourly_sent) as remaining_hourly,
        COUNT(*) as total_accounts,
        SUM(CASE WHEN is_active = 1 AND is_paused = 0 AND daily_sent < daily_limit THEN 1 ELSE 0 END) as active_accounts
      FROM sender_accounts
      WHERE is_active = 1 AND is_paused = 0
    `);
    return res.rows[0];
  } catch (e) {
    console.error('Get remaining capacity error:', e.message);
    return { remaining_daily: 0, remaining_hourly: 0, total_accounts: 0, active_accounts: 0 };
  }
}

module.exports = {
  sendWithRotation,
  getNextSender,
  getAccountsStatus,
  getRemainingCapacity,
  resetCountersIfNeeded,
};
