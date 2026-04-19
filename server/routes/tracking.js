const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /t/o/:trackingId - Open tracking pixel
router.get('/o/:trackingId', (req, res) => {
  const { trackingId } = req.params;
  const db = getDb();

  // Skip bots and pre-fetchers (Apple Mail proxy, Google image proxy, etc.)
  const ua = req.get('user-agent') || '';
  const isBotOrProxy = /googleimageproxy|google image proxy|yahoo|bing|apple|msnbot|bot|crawler|spider|preview|prefetch|facebookexternalhit/i.test(ua);

  try {
    const lead = db.prepare(`SELECT id, campaign_id, open_count FROM leads WHERE tracking_id = ?`).get(trackingId);
    const seqLog = !lead ? db.prepare(`SELECT id, lead_id, open_count FROM sequence_log WHERE tracking_id = ?`).get(trackingId) : null;

    if (!isBotOrProxy) {
      if (lead) {
        // Always log the raw event
        db.prepare(`
          INSERT INTO tracking_events (tracking_id, lead_id, event_type, ip_address, user_agent)
          VALUES (?, ?, 'open', ?, ?)
        `).run(trackingId, lead.id, req.ip, ua);

        // Only increment campaign open count on the FIRST open
        const isFirstOpen = lead.open_count === 0;
        db.prepare(`
          UPDATE leads SET open_count = open_count + 1, last_opened_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(lead.id);

        if (isFirstOpen) {
          db.prepare(`
            UPDATE campaigns SET open_count = open_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).run(lead.campaign_id);
        }
      } else if (seqLog) {
        db.prepare(`
          INSERT INTO tracking_events (tracking_id, lead_id, event_type, ip_address, user_agent)
          VALUES (?, ?, 'open', ?, ?)
        `).run(trackingId, seqLog.lead_id, req.ip, ua);

        db.prepare(`
          UPDATE sequence_log SET open_count = open_count + 1 WHERE id = ?
        `).run(seqLog.id);

        // Only increment parent lead on first open
        const parentLead = db.prepare(`SELECT open_count FROM leads WHERE id = ?`).get(seqLog.lead_id);
        db.prepare(`
          UPDATE leads SET open_count = open_count + 1, last_opened_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(seqLog.lead_id);
      }
    }
  } catch (err) {
    console.error('Open tracking error:', err.message);
  }

  // Always return a 1x1 transparent GIF
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(pixel);
});

// GET /t/c/:trackingId - Click tracking redirect
router.get('/c/:trackingId', (req, res) => {
  const { trackingId } = req.params;
  const { url } = req.query;
  const db = getDb();

  if (!url) {
    return res.status(400).send('Missing redirect URL');
  }

  // Filter known bots/crawlers
  const ua = req.get('user-agent') || '';
  const isBotOrProxy = /googleimageproxy|google image proxy|yahoo|bing|apple|msnbot|bot|crawler|spider|preview|prefetch|facebookexternalhit/i.test(ua);

  try {
    if (!isBotOrProxy) {
      const lead = db.prepare(`SELECT id, campaign_id, click_count FROM leads WHERE tracking_id = ?`).get(trackingId);
      const seqLog = !lead ? db.prepare(`SELECT id, lead_id, click_count FROM sequence_log WHERE tracking_id = ?`).get(trackingId) : null;

      if (lead) {
        // Check if this exact URL was already clicked (deduplicate per unique link)
        const alreadyClicked = db.prepare(`
          SELECT id FROM tracking_events 
          WHERE tracking_id = ? AND event_type = 'click' AND link_url = ?
          LIMIT 1
        `).get(trackingId, url);

        db.prepare(`
          INSERT INTO tracking_events (tracking_id, lead_id, event_type, link_url, ip_address, user_agent)
          VALUES (?, ?, 'click', ?, ?, ?)
        `).run(trackingId, lead.id, url, req.ip, ua);

        // Always update lead click count
        db.prepare(`
          UPDATE leads SET click_count = click_count + 1, last_clicked_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(lead.id);

        // Only increment campaign click count on first click of this link
        if (!alreadyClicked) {
          db.prepare(`
            UPDATE campaigns SET click_count = click_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).run(lead.campaign_id);
        }
      } else if (seqLog) {
        db.prepare(`
          INSERT INTO tracking_events (tracking_id, lead_id, event_type, link_url, ip_address, user_agent)
          VALUES (?, ?, 'click', ?, ?, ?)
        `).run(trackingId, seqLog.lead_id, url, req.ip, ua);

        db.prepare(`
          UPDATE sequence_log SET click_count = click_count + 1 WHERE id = ?
        `).run(seqLog.id);

        db.prepare(`
          UPDATE leads SET click_count = click_count + 1, last_clicked_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(seqLog.lead_id);
      }
    }
  } catch (err) {
    console.error('Click tracking error:', err.message);
  }

  // Redirect to the original URL regardless
  res.redirect(302, decodeURIComponent(url));
});

module.exports = router;

