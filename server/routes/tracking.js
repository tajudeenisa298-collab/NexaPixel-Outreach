const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /t/o/:trackingId - Open tracking pixel
router.get('/o/:trackingId', async (req, res) => {
  const { trackingId } = req.params;
  const ua = req.get('user-agent') || '';
  const isBotOrProxy = /googleimageproxy|google image proxy|yahoo|bing|apple|msnbot|bot|crawler|spider|preview|prefetch|facebookexternalhit/i.test(ua);

  try {
    const db = await getDb();
    
    // Find in main leads table
    const leadRes = await db.query('SELECT id, campaign_id, open_count FROM leads WHERE tracking_id = $1', [trackingId]);
    const lead = leadRes.rows[0];
    
    // If not found, check sequence log
    let seqLog = null;
    if (!lead) {
      const seqRes = await db.query('SELECT id, lead_id, open_count FROM sequence_log WHERE tracking_id = $1', [trackingId]);
      seqLog = seqRes.rows[0];
    }

    if (!isBotOrProxy) {
      if (lead) {
        await db.query(`
          INSERT INTO tracking_events (tracking_id, lead_id, event_type, ip_address, user_agent)
          VALUES ($1, $2, 'open', $3, $4)
        `, [trackingId, lead.id, req.ip, ua]);

        const isFirstOpen = parseInt(lead.open_count) === 0;
        await db.query(`
          UPDATE leads SET open_count = open_count + 1, last_opened_at = CURRENT_TIMESTAMP WHERE id = $1
        `, [lead.id]);

        if (isFirstOpen) {
          await db.query(`
            UPDATE campaigns SET open_count = open_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1
          `, [lead.campaign_id]);
        }
      } else if (seqLog) {
        await db.query(`
          INSERT INTO tracking_events (tracking_id, lead_id, event_type, ip_address, user_agent)
          VALUES ($1, $2, 'open', $3, $4)
        `, [trackingId, seqLog.lead_id, req.ip, ua]);

        await db.query(`
          UPDATE sequence_log SET open_count = open_count + 1 WHERE id = $1
        `, [seqLog.id]);

        await db.query(`
          UPDATE leads SET open_count = open_count + 1, last_opened_at = CURRENT_TIMESTAMP WHERE id = $1
        `, [seqLog.lead_id]);
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
router.get('/c/:trackingId', async (req, res) => {
  const { trackingId } = req.params;
  const { url } = req.query;
  const ua = req.get('user-agent') || '';
  const isBotOrProxy = /googleimageproxy|google image proxy|yahoo|bing|apple|msnbot|bot|crawler|spider|preview|prefetch|facebookexternalhit/i.test(ua);

  if (!url) {
    return res.status(400).send('Missing redirect URL');
  }

  try {
    const db = await getDb();
    if (!isBotOrProxy) {
      const leadRes = await db.query('SELECT id, campaign_id, click_count FROM leads WHERE tracking_id = $1', [trackingId]);
      const lead = leadRes.rows[0];
      
      let seqLog = null;
      if (!lead) {
        const seqRes = await db.query('SELECT id, lead_id, click_count FROM sequence_log WHERE tracking_id = $1', [trackingId]);
        seqLog = seqRes.rows[0];
      }

      if (lead) {
        const clickedRes = await db.query(`
          SELECT id FROM tracking_events 
          WHERE tracking_id = $1 AND event_type = 'click' AND link_url = $2
          LIMIT 1
        `, [trackingId, url]);
        const alreadyClicked = clickedRes.rowCount > 0;

        await db.query(`
          INSERT INTO tracking_events (tracking_id, lead_id, event_type, link_url, ip_address, user_agent)
          VALUES ($1, $2, 'click', $3, $4, $5)
        `, [trackingId, lead.id, url, req.ip, ua]);

        await db.query(`
          UPDATE leads SET click_count = click_count + 1, last_clicked_at = CURRENT_TIMESTAMP WHERE id = $1
        `, [lead.id]);

        if (!alreadyClicked) {
          await db.query(`
            UPDATE campaigns SET click_count = click_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1
          `, [lead.campaign_id]);
        }
      } else if (seqLog) {
        await db.query(`
          INSERT INTO tracking_events (tracking_id, lead_id, event_type, link_url, ip_address, user_agent)
          VALUES ($1, $2, 'click', $3, $4, $5)
        `, [trackingId, seqLog.lead_id, url, req.ip, ua]);

        await db.query(`
          UPDATE sequence_log SET click_count = click_count + 1 WHERE id = $1
        `, [seqLog.id]);

        await db.query(`
          UPDATE leads SET click_count = click_count + 1, last_clicked_at = CURRENT_TIMESTAMP WHERE id = $1
        `, [seqLog.lead_id]);
      }
    }
  } catch (err) {
    console.error('Click tracking error:', err.message);
  }

  // Redirect to the original URL regardless
  res.redirect(302, decodeURIComponent(url));
});

module.exports = router;
