const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { verifyGmailAccount } = require('../services/gmailSender');

// POST /api/accounts - Add a new sender account
router.post('/', async (req, res) => {
  const { email, password, type, display_name } = req.body;
  
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
    const db = await getDb();
    await db.query(`
      INSERT INTO sender_accounts (email, type, password, display_name, daily_limit, hourly_limit)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [email, type, password, display_name || email.split('@')[0], limits.daily, limits.hourly]);
    
    res.status(201).json({ success: true, message: 'Account added successfully' });
  } catch (err) {
    if (err.message.includes('unique constraint') || err.code === '23505') {
      return res.status(400).json({ error: 'This email is already connected' });
    }
    console.error('Add account error:', err);
    res.status(500).json({ error: 'Failed to add account' });
  }
});

// DELETE /api/accounts/:id - Remove a sender account
router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    await db.query(`DELETE FROM sender_accounts WHERE id = $1`, [req.params.id]);
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/accounts/:id/pause - Toggle sender pause state
router.put('/:id/pause', async (req, res) => {
  try {
    const { is_paused } = req.body;
    const db = await getDb();
    await db.query(`UPDATE sender_accounts SET is_paused = $1 WHERE id = $2`, [is_paused ? 1 : 0, req.params.id]);
    res.json({ success: true, message: is_paused ? 'Account paused' : 'Account resumed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
