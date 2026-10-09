// Keeps the OAuth tokens + realmId so you don't have to reconnect every time the server restarts.
// Stored in tokens.json locally, or in Redis on Vercel (see services/store.js).
// (A real app would store this encrypted, per user.)
const store = require('./store');

const KEY = 'tokens';

// Returns the saved data, or null if we have never connected.
const load = () => store.get(KEY);

// data = { access_token, refresh_token, expires_in, x_refresh_token_expires_in, createdAt, realmId, companyName? }
const save = (data) => store.set(KEY, data);

const clear = () => store.del(KEY);

module.exports = { load, save, clear };
