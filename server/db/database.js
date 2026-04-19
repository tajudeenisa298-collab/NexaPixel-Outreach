const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'outreach.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sender_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('gmail', 'brevo', 'outlook', 'zoho', 'smtp')),
      password TEXT,
      display_name TEXT,
      daily_sent INTEGER DEFAULT 0,
      daily_limit INTEGER DEFAULT 400,
      hourly_sent INTEGER DEFAULT 0,
      hourly_limit INTEGER DEFAULT 35,
      last_daily_reset DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_hourly_reset DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      is_paused INTEGER DEFAULT 0,
      last_error TEXT,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
      total_leads INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      open_count INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'queued', 'sending', 'sent', 'failed', 'bounced')),
      sent_at DATETIME,
      sent_via TEXT,
      sender_email TEXT,
      tracking_id TEXT UNIQUE,
      open_count INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      last_opened_at DATETIME,
      last_clicked_at DATETIME,
      error_message TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      delay_days INTEGER NOT NULL DEFAULT 1,
      subject_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      condition TEXT DEFAULT 'no_open' CHECK(condition IN ('no_open', 'no_click', 'always')),
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sequence_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'skipped', 'failed')),
      tracking_id TEXT UNIQUE,
      scheduled_at DATETIME NOT NULL,
      sent_at DATETIME,
      open_count INTEGER DEFAULT 0,
      click_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tracking_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_id TEXT NOT NULL,
      lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('open', 'click')),
      link_url TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER REFERENCES campaigns(id),
      lead_id INTEGER REFERENCES leads(id),
      sender_email TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_tracking ON leads(tracking_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_events_tracking_id ON tracking_events(tracking_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_events_type ON tracking_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_sequence_log_lead ON sequence_log(lead_id);
    CREATE INDEX IF NOT EXISTS idx_sequence_log_status ON sequence_log(status);
    CREATE INDEX IF NOT EXISTS idx_send_log_campaign ON send_log(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_sender_accounts_type ON sender_accounts(type);
  `);

  // Initialize default settings if they don't exist
  try {
    const checkStmt = db.prepare("SELECT value FROM settings WHERE key = 'send_interval'");
    if (!checkStmt.get()) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('send_interval', '35000')").run();
    }
  } catch (err) {
    console.error('Error initializing settings:', err);
  }

  try {
    db.exec('ALTER TABLE sender_accounts ADD COLUMN password TEXT;');
  } catch (err) {
    // Column already exists
  }

  try {
    db.exec('ALTER TABLE sender_accounts ADD COLUMN is_paused INTEGER DEFAULT 0;');
  } catch (err) {
    // Column already exists
  }
}

function seedSenderAccounts() {
  const db = getDb();
  
  // Reactivate all disabled accounts on startup to clear any critical error locks
  try {
    db.prepare(`UPDATE sender_accounts SET is_active = 1, last_error = NULL`).run();
  } catch (e) {
    console.log(e);
  }
}

module.exports = { getDb, seedSenderAccounts };
