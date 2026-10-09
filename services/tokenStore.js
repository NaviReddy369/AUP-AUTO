// Tiny persistence layer: keeps the OAuth tokens + realmId in tokens.json
// so you don't have to reconnect every time the server restarts.
// (A real app would store this encrypted in a database, per user.)
const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '..', 'tokens.json');

// Returns the saved data, or null if we have never connected.
function load() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  } catch {
    return null; // file missing or unreadable -> treat as "not connected"
  }
}

// data = { access_token, refresh_token, expires_in, x_refresh_token_expires_in, createdAt, realmId, companyName? }
function save(data) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
}

function clear() {
  if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
}

module.exports = { load, save, clear };
