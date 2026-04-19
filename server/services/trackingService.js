const { v4: uuidv4 } = require('uuid');

const TRACKING_BASE = process.env.TRACKING_BASE_URL || 'http://localhost:3001';

/**
 * Generate a unique tracking ID
 */
function generateTrackingId() {
  return uuidv4();
}

/**
 * Create a tracking pixel <img> tag
 * @param {string} trackingId
 * @returns {string} HTML img tag
 */
function createTrackingPixel(trackingId) {
  const url = `${TRACKING_BASE}/t/o/${trackingId}`;
  return `<img src="${url}" width="1" height="1" style="display:none;width:1px;height:1px;border:0;" alt="" />`;
}

/**
 * Wrap a URL with click tracking
 * @param {string} trackingId
 * @param {string} originalUrl
 * @returns {string} tracked URL
 */
function createTrackedLink(trackingId, originalUrl) {
  return `${TRACKING_BASE}/t/c/${trackingId}?url=${encodeURIComponent(originalUrl)}`;
}

/**
 * Convert plain text body to HTML with tracking
 * Detects URLs in text and makes them clickable with tracking
 * @param {string} text - plain text body
 * @param {string} trackingId
 * @returns {string} HTML body with tracking pixel and tracked links
 */
function prepareEmailBody(text, trackingId) {
  // Escape HTML special chars
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert URLs to tracked clickable links
  const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
  html = html.replace(urlRegex, (url) => {
    const trackedUrl = createTrackedLink(trackingId, url);
    return `<a href="${trackedUrl}" style="color:#6366f1;text-decoration:underline;">${url}</a>`;
  });

  // Convert newlines to <br>
  html = html.replace(/\n/g, '<br/>');

  // Wrap in a styled container + append tracking pixel
  const styledHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1a1a1a; padding: 0; margin: 0;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    ${html}
  </div>
  ${createTrackingPixel(trackingId)}
</body>
</html>`.trim();

  return styledHtml;
}

module.exports = {
  generateTrackingId,
  createTrackingPixel,
  createTrackedLink,
  prepareEmailBody,
};
