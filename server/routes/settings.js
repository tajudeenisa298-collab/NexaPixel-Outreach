const express = require('express');
const router = express.Router();
const { updateSendInterval, getQueueStatus } = require('../services/emailQueue');

/**
 * GET /api/settings - Get current settings
 */
router.get('/', (req, res) => {
  const status = getQueueStatus();
  res.json({
    send_interval: status.sendInterval
  });
});

/**
 * POST /api/settings/send-interval - Update send interval
 */
router.post('/send-interval', (req, res) => {
  const { interval } = req.body;
  console.log(`[API] Received pace update request: ${interval}ms`);
  
  if (!interval || isNaN(interval)) {
    return res.status(400).json({ error: 'Valid interval (ms) required' });
  }

  try {
    updateSendInterval(parseInt(interval));
    res.json({ success: true, interval: parseInt(interval) });
  } catch (err) {
    console.error('Failed to update send interval:', err);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

module.exports = router;
