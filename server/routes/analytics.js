const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getAccountsStatus, getRemainingCapacity } = require('../services/senderRotation');
const { getQueueStatus } = require('../services/emailQueue');

// GET /api/analytics/overview - Dashboard overview stats
router.get('/overview', (req, res) => {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_campaigns,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_campaigns,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_campaigns,
      SUM(sent_count) as total_sent,
      SUM(open_count) as total_opens,
      SUM(click_count) as total_clicks,
      SUM(failed_count) as total_failed
    FROM campaigns
  `).get();

  const totalLeads = db.prepare(`SELECT COUNT(*) as count FROM leads`).get();

  const openRate = totals.total_sent > 0
    ? ((totals.total_opens / totals.total_sent) * 100).toFixed(1)
    : 0;

  const clickRate = totals.total_sent > 0
    ? ((totals.total_clicks / totals.total_sent) * 100).toFixed(1)
    : 0;

  const capacity = getRemainingCapacity();
  const queueStatus = getQueueStatus();

  res.json({
    ...totals,
    total_leads: totalLeads.count,
    open_rate: parseFloat(openRate),
    click_rate: parseFloat(clickRate),
    capacity,
    queue: queueStatus,
  });
});

// GET /api/analytics/daily - Daily send stats for charts
router.get('/daily', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days) || 30;

  const dailyStats = db.prepare(`
    SELECT
      date(created_at) as date,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM send_log
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all(days);

  const dailyTracking = db.prepare(`
    SELECT
      date(created_at) as date,
      SUM(CASE WHEN event_type = 'open' THEN 1 ELSE 0 END) as opens,
      SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) as clicks
    FROM tracking_events
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all(days);

  res.json({ dailyStats, dailyTracking });
});

// GET /api/analytics/accounts - Sender account status
router.get('/accounts', (req, res) => {
  const accounts = getAccountsStatus();
  const capacity = getRemainingCapacity();
  res.json({ accounts, capacity });
});

// GET /api/analytics/recent - Recent send activity
router.get('/recent', (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 50;

  const recent = db.prepare(`
    SELECT sl.*, c.name as campaign_name
    FROM send_log sl
    LEFT JOIN campaigns c ON c.id = sl.campaign_id
    ORDER BY sl.created_at DESC
    LIMIT ?
  `).all(limit);

  res.json(recent);
});

// GET /api/analytics/top-performing - Top performing leads
router.get('/top-performing', (req, res) => {
  const db = getDb();

  const topOpened = db.prepare(`
    SELECT recipient_email, first_name, last_name, open_count, click_count, subject
    FROM leads
    WHERE open_count > 0
    ORDER BY open_count DESC
    LIMIT 20
  `).all();

  const topClicked = db.prepare(`
    SELECT recipient_email, first_name, last_name, open_count, click_count, subject
    FROM leads
    WHERE click_count > 0
    ORDER BY click_count DESC
    LIMIT 20
  `).all();

  res.json({ topOpened, topClicked });
});

module.exports = router;
