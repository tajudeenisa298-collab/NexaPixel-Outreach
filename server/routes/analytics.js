const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getAccountsStatus, getRemainingCapacity } = require('../services/senderRotation');
const { getQueueStatus } = require('../services/emailQueue');

// GET /api/analytics/overview - Dashboard overview stats
router.get('/overview', async (req, res) => {
  try {
    const db = await getDb();

    const totalsResult = await db.query(`
      SELECT
        COUNT(*) as total_campaigns,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_campaigns,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_campaigns,
        SUM(sent_count) as total_sent,
        SUM(open_count) as total_opens,
        SUM(click_count) as total_clicks,
        SUM(failed_count) as total_failed
      FROM campaigns
    `);
    const totals = totalsResult.rows[0];

    const totalLeadsResult = await db.query(`SELECT COUNT(*) as count FROM leads`);
    const totalLeads = totalLeadsResult.rows[0];

    const totalSentCount = parseInt(totals.total_sent || 0);
    const totalOpenCount = parseInt(totals.total_opens || 0);
    const totalClickCount = parseInt(totals.total_clicks || 0);

    const openRate = totalSentCount > 0
      ? ((totalOpenCount / totalSentCount) * 100).toFixed(1)
      : 0;

    const clickRate = totalSentCount > 0
      ? ((totalClickCount / totalSentCount) * 100).toFixed(1)
      : 0;

    const capacity = await getRemainingCapacity();
    const queueStatus = await getQueueStatus();

    res.json({
      ...totals,
      total_leads: parseInt(totalLeads.count),
      open_rate: parseFloat(openRate),
      click_rate: parseFloat(clickRate),
      capacity,
      queue: queueStatus,
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/daily - Daily send stats for charts
router.get('/daily', async (req, res) => {
  try {
    const db = await getDb();
    const days = parseInt(req.query.days) || 30;

    const dailyStatsResult = await db.query(`
      SELECT
        DATE(created_at) as date,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM send_log
      WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [days]);

    const dailyTrackingResult = await db.query(`
      SELECT
        DATE(created_at) as date,
        SUM(CASE WHEN event_type = 'open' THEN 1 ELSE 0 END) as opens,
        SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) as clicks
      FROM tracking_events
      WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [days]);

    res.json({ 
      dailyStats: dailyStatsResult.rows, 
      dailyTracking: dailyTrackingResult.rows 
    });
  } catch (error) {
    console.error('Analytics daily stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/accounts - Sender account status
router.get('/accounts', (req, res) => {
  const accounts = getAccountsStatus();
  const capacity = getRemainingCapacity();
  res.json({ accounts, capacity });
});

// GET /api/analytics/recent - Recent send activity
router.get('/recent', async (req, res) => {
  try {
    const db = await getDb();
    const limit = parseInt(req.query.limit) || 50;

    const recentResult = await db.query(`
      SELECT sl.*, c.name as campaign_name
      FROM send_log sl
      LEFT JOIN campaigns c ON c.id = sl.campaign_id
      ORDER BY sl.created_at DESC
      LIMIT $1
    `, [limit]);

    res.json(recentResult.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/top-performing - Top performing leads
router.get('/top-performing', async (req, res) => {
  try {
    const db = await getDb();

    const topOpenedResult = await db.query(`
      SELECT recipient_email, first_name, last_name, open_count, click_count, subject
      FROM leads
      WHERE open_count > 0
      ORDER BY open_count DESC
      LIMIT 20
    `);

    const topClickedResult = await db.query(`
      SELECT recipient_email, first_name, last_name, open_count, click_count, subject
      FROM leads
      WHERE click_count > 0
      ORDER BY click_count DESC
      LIMIT 20
    `);

    res.json({ 
      topOpened: topOpenedResult.rows, 
      topClicked: topClickedResult.rows 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
