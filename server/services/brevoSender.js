/**
 * Brevo API Sender
 * Uses fetch to call Brevo's transactional email API directly
 * (avoids SDK version issues)
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Send an email via Brevo API
 * @param {Object} account - { apiKey, email, name }
 * @param {Object} emailData - { to, subject, text, html }
 * @returns {Promise<Object>}
 */
async function sendViaBrevo(account, emailData) {
  const payload = {
    sender: {
      name: account.name || 'NexaPixel',
      email: account.email,
    },
    to: [
      {
        email: emailData.to,
        name: emailData.toName || emailData.to.split('@')[0],
      },
    ],
    subject: emailData.subject,
    textContent: emailData.text,
  };

  if (emailData.html) {
    payload.htmlContent = emailData.html;
  }

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': account.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, messageId: data.messageId };
    } else {
      return { success: false, error: data.message || 'Brevo API error', code: response.status };
    }
  } catch (error) {
    console.error(`Brevo send error (${account.email}):`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { sendViaBrevo };
