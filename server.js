// AUP Auto – entry point. Run with: node server.js
// Load .env FIRST so services/quickbooks.js sees CLIENT_ID etc. when it is required.
require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');

const PORT = process.env.PORT || 3000;
const app = express();

// Warn (don't crash) if the keys are missing, so the UI can still explain what to do.
const missing = ['CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI'].filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(`\n⚠  Missing in .env: ${missing.join(', ')}`);
  console.warn('   Copy your sandbox keys from developer.intuit.com into .env, then restart.\n');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // HTML/CSS/JS pages
app.use('/', authRoutes);                                // /connect, /callback, /disconnect, /api/status
app.use('/api', dataRoutes);                             // /api/accounts, /api/sync, ...

// Unknown /api route -> JSON 404 instead of an HTML page.
app.use('/api', (req, res) => res.status(404).json({ error: `No API route ${req.path}`, kind: 'server' }));

// Locally (`node server.js`) we start a server. On Vercel, api/index.js imports the app instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`AUP Auto running at http://localhost:${PORT}`);
  });
}

module.exports = app;
