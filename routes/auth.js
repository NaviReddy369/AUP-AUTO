// OAuth 2.0 routes: /connect -> Intuit login -> /callback, plus /disconnect and /api/status.
const express = require('express');
const crypto = require('crypto');
const qbo = require('../services/quickbooks');
const tokenStore = require('../services/tokenStore');

const router = express.Router();

// The "state" value protects against CSRF: we create a random value, send it to Intuit,
// and Intuit must send the exact same value back to /callback.
// Kept in a short-lived cookie (not in memory) because on Vercel /connect and /callback
// can run on different server instances.
const STATE_COOKIE = 'qbo_oauth_state';

function readCookie(req, name) {
  const pair = (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name);
  return pair ? decodeURIComponent(pair[1]) : null;
}

router.get('/connect', (req, res) => {
  if (!qbo.hasKeys()) {
    return res.redirect('/?error=' + encodeURIComponent('Missing CLIENT_ID / CLIENT_SECRET / REDIRECT_URI in .env – fill them in and restart the server.'));
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax', // sent on the top-level redirect back from Intuit
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(qbo.getAuthorizeUrl(state));
});

router.get('/callback', async (req, res) => {
  const { code, state, realmId, error } = req.query;

  // User clicked "Cancel" / denied access on the Intuit screen.
  if (error) return res.redirect('/?error=' + encodeURIComponent(`Intuit returned: ${error}`));

  const expectedState = readCookie(req, STATE_COOKIE);
  res.clearCookie(STATE_COOKIE); // a state value can only be used once
  if (!state || state !== expectedState) {
    return res.redirect('/?error=' + encodeURIComponent('Invalid OAuth state – please click "Connect QuickBooks" again.'));
  }

  if (!code || !realmId) {
    return res.redirect('/?error=' + encodeURIComponent('Callback is missing code or realmId.'));
  }

  try {
    await qbo.handleCallback(req.url, realmId);
    // Fetch the company name right away so the home page can display it.
    await qbo.getCompanyInfo().catch(() => {});
    res.redirect('/?connected=1');
  } catch (err) {
    console.error('[auth] token exchange failed:', err.error_description || err.message);
    res.redirect('/?error=' + encodeURIComponent(`Token exchange failed: ${err.error_description || err.message}`));
  }
});

router.post('/disconnect', async (req, res) => {
  await qbo.disconnect();
  res.json({ ok: true });
});

// Connection status for the home page (no QBO API call needed).
router.get('/api/status', async (req, res) => {
  const t = await tokenStore.load();
  res.json({
    keysConfigured: qbo.hasKeys(),
    connected: Boolean(t && t.refresh_token && t.realmId),
    realmId: t?.realmId || null,
    companyName: t?.companyName || null,
    accessTokenExpiresAt: t ? new Date(t.createdAt + t.expires_in * 1000).toISOString() : null,
    environment: 'sandbox',
  });
});

module.exports = router;
