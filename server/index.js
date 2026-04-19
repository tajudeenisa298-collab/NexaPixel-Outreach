require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, initSchema, seedSenderAccounts } = require('./db/database');
const { resumeOnStartup, loadSettings } = require('./services/emailQueue');
const { startSequenceEngine } = require('./services/sequenceEngine');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy for IP tracking
app.set('trust proxy', true);

const { pool } = require('./db/database');

async function startApp() {
  try {
    // Initialize database
    await initSchema();
    console.log('Database schema initialized');
    
    await loadSettings();
    await seedSenderAccounts();
  } catch (error) {
    console.error('Failed to initialize app state:', error);
  }
}

startApp();

// API Routes
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/settings', require('./routes/settings'));

// Tracking Routes (short paths for email pixels/links)
app.use('/t', require('./routes/tracking'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║        NexaPixel Outreach Dashboard Server            ║
║        Running on http://localhost:${PORT}               ║
╚═══════════════════════════════════════════════════════╝
  `);

  // Resume any active campaigns from previous session
  resumeOnStartup();

  // Start follow-up sequence engine
  startSequenceEngine();
});
