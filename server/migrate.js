const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'outreach.db');
const db = new Database(DB_PATH);

try {
  db.exec('BEGIN TRANSACTION');

  // Create new table with updated schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS sender_accounts_new (
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
  `);

  // Copy data
  db.exec(`
    INSERT INTO sender_accounts_new (
      id, email, type, password, display_name, daily_sent, daily_limit,
      hourly_sent, hourly_limit, last_daily_reset, last_hourly_reset,
      is_active, last_error, last_used_at, created_at
    )
    SELECT
      id, email, type, password, display_name, daily_sent, daily_limit,
      hourly_sent, hourly_limit, last_daily_reset, last_hourly_reset,
      is_active, last_error, last_used_at, created_at
    FROM sender_accounts;
  `);

  // Drop old table
  db.exec('DROP TABLE sender_accounts;');

  // Rename new table
  db.exec('ALTER TABLE sender_accounts_new RENAME TO sender_accounts;');

  // Re-create indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sender_accounts_type ON sender_accounts(type);`);

  db.exec('COMMIT');
  console.log('Migration completed successfully.');
} catch (error) {
  db.exec('ROLLBACK');
  console.error('Migration failed:', error);
}
