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

async function startApp() {
  try {
    // Initialize database
    await initSchema();
    console.log('✅ Database schema initialized');
    
    await loadSettings();
    await seedSenderAccounts();
  } catch (error) {
    console.error('❌ Failed to initialize app state:', error);
  }
}

// Global error handler for async routes in Express 5
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start initialization
startApp();

// API Routes
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/settings', require('./routes/settings'));

// Tracking Routes
app.use('/t', require('./routes/tracking'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  
  // Use a more robust catch-all for SPAs
  app.get('*', (req, res) => {
    // Only handle non-API routes
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/t/')) {
       res.sendFile(path.join(distPath, 'index.html'), (err) => {
         if (err) {
           res.status(404).send('Frontend not built yet. Run build first.');
         }
       });
    }
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Background services
  resumeOnStartup();
  startSequenceEngine();
});
