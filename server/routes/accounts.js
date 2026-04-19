const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { verifyGmailAccount } = require('../services/gmailSender');

// POST /api/accounts - Add a new sender account
router.post('/', async (req, res) => {
  const { email, password, type, display_name } = req.body;
  const db = getDb();

  if (!email || !password || !type) {
    return res.status(400).json({ error: 'Email, password, and type are required' });
  }

  const allowedTypes = ['gmail', 'brevo', 'outlook', 'zoho', 'smtp'];
  if (!allowedTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid account type' });
  }

  // Pre-validate SMTP credentials
  if (type === 'gmail' || type === 'outlook' || type === 'zoho' || type === 'smtp') {
    const result = await verifyGmailAccount(email, password, type);
    if (!result.valid) {
      return res.status(400).json({ error: `Verification failed: ${result.error}` });
    }
  }

  const limits = (type === 'gmail' || type === 'outlook' || type === 'zoho' || type === 'smtp')
    ? { daily: 400, hourly: 35 } 
    : { daily: 300, hourly: 50 };

  try {
    const insertStmt = db.prepare(`
      INSERT INTO sender_accounts (email, type, password, display_name, daily_limit, hourly_limit)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(email, type, password, display_name || email.split('@')[0], limits.daily, limits.hourly);
    res.status(201).json({ success: true, message: 'Account added successfully' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'This email is already connected' });
    }
    console.error('Add account error:', err);
    res.status(500).json({ error: 'Failed to add account' });
  }
});

// DELETE /api/accounts/:id - Remove a sender account
router.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    db.prepare(`DELETE FROM sender_accounts WHERE id = ?`).run(req.params.id);
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/accounts/:id/pause - Toggle sender pause state
router.put('/:id/pause', (req, res) => {
  const { is_paused } = req.body;
  const db = getDb();
  try {
    db.prepare(`UPDATE sender_accounts SET is_paused = ? WHERE id = ?`).run(is_paused ? 1 : 0, req.params.id);
    res.json({ success: true, message: is_paused ? 'Account paused' : 'Account resumed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
