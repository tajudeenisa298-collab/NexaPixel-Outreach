const nodemailer = require('nodemailer');

// Cache transporters to avoid recreating them
const transporterCache = new Map();

function getTransporter(email, password, type = 'gmail') {
  const key = email;
  if (transporterCache.has(key)) {
    return transporterCache.get(key);
  }

  const transportConfig = {
    pool: true,
    maxConnections: 1,
    maxMessages: 10,
    rateDelta: 30000, // 30 seconds between messages
    rateLimit: 1,
    auth: {
      user: email,
      pass: password,
    },
    connectionTimeout: 30000, // 30 seconds
    greetingTimeout: 30000,   // 30 seconds
    socketTimeout: 30000      // 30 seconds
  };

  if (type === 'gmail') {
    transportConfig.host = 'smtp.gmail.com';
    transportConfig.port = 587;
    transportConfig.secure = false; // Use STARTTLS
    transportConfig.debug = true;   // See connection details in logs
    transportConfig.logger = true;  // Log to console
  } else if (type === 'outlook') {
    transportConfig.service = 'hotmail'; // nodemailer maps hotmail to Outlook/Hotmail servers
  } else if (type === 'zoho') {
    transportConfig.service = 'zoho';
  } else if (type === 'smtp') {
    // Basic fallback, assuming host can be derived from email domain or standard settings
    transportConfig.host = `smtp.${email.split('@')[1]}`;
    transportConfig.port = 465;
    transportConfig.secure = true;
  }

  const transporter = nodemailer.createTransport(transportConfig);

  transporterCache.set(key, transporter);
  return transporter;
}

/**
 * Send an email via SMTP
 * @param {Object} account - { email, password, type }
 * @param {Object} emailData - { to, subject, text, html, replyTo }
 * @returns {Promise<Object>} - send result
 */
async function sendViaGmail(account, emailData) {
  const transporter = getTransporter(account.email, account.password, account.type);

  const mailOptions = {
    from: `"${account.displayName || account.email.split('@')[0]}" <${account.email}>`,
    to: emailData.to,
    subject: emailData.subject,
    text: emailData.text,
  };

  if (emailData.html) {
    mailOptions.html = emailData.html;
  }

  if (emailData.replyTo) {
    mailOptions.replyTo = emailData.replyTo;
  }

  try {
    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId, response: result.response };
  } catch (error) {
    console.error(`Gmail send error (${account.email}):`, error.message);
    return { success: false, error: error.message, code: error.code };
  }
}

/**
 * Verify an SMTP account's credentials
 */
async function verifyGmailAccount(email, password, type) {
  try {
    const transporter = getTransporter(email, password, type);
    await transporter.verify();
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

module.exports = { sendViaGmail, verifyGmailAccount };
