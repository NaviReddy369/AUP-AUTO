// Everything that talks to Intuit lives here:
//  - the OAuth client (connect / token exchange / refresh / revoke)
//  - getValidToken(): returns a fresh access token, refreshing it if needed
//  - query(): runs a QuickBooks SQL-like query and follows pagination
//  - normalizeTxn(): turns the 4 different transaction shapes into one flat row
const OAuthClient = require('intuit-oauth');
const tokenStore = require('./tokenStore');

const API_BASE = 'https://sandbox-quickbooks.api.intuit.com';
const MINOR_VERSION = 75; // QBO API "minor version" – controls which fields come back
const PAGE_SIZE = 1000;   // QBO allows max 1000 rows per query page

// ---------- Error types (so routes can show friendly messages) ----------
class NotConnectedError extends Error {
  constructor(msg = 'Not connected to QuickBooks. Click "Connect QuickBooks" first.') {
    super(msg);
    this.kind = 'not_connected';
    this.status = 401;
  }
}
class TokenExpiredError extends Error {
  constructor(msg = 'Your QuickBooks connection expired (refresh token no longer valid). Please reconnect.') {
    super(msg);
    this.kind = 'expired';
    this.status = 401;
  }
}
class QboApiError extends Error {
  constructor(msg, status, raw) {
    super(msg);
    this.kind = 'api';
    this.status = status || 502;
    this.raw = raw;
  }
}

// ---------- OAuth client ----------
// One client for the whole app (single-user demo). Keys come from .env only.
const oauthClient = new OAuthClient({
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  environment: 'sandbox',
  redirectUri: process.env.REDIRECT_URI,
});

function hasKeys() {
  return Boolean(process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.REDIRECT_URI);
}

// Step 1 of OAuth: the URL we send the user to so they can approve access.
function getAuthorizeUrl(state) {
  return oauthClient.authorizeUri({ scope: [OAuthClient.scopes.Accounting], state });
}

// Step 2 of OAuth: Intuit redirected back to /callback?code=...&realmId=...&state=...
// Exchange the one-time code for access + refresh tokens and save them.
async function handleCallback(callbackUrl, realmId) {
  const authResponse = await oauthClient.createToken(callbackUrl);
  const token = authResponse.getJson();
  await tokenStore.save({ ...token, createdAt: Date.now(), realmId });
}

// Access tokens live ~1 hour, refresh tokens ~100 days.
// We refresh a minute early so a request never goes out with a token that dies mid-flight.
function isAccessTokenExpired(t) {
  return Date.now() > t.createdAt + (t.expires_in - 60) * 1000;
}

async function refreshTokens(saved) {
  oauthClient.setToken(saved);
  try {
    const authResponse = await oauthClient.refresh();
    // Intuit may hand back a NEW refresh token – always save the latest one.
    const fresh = { ...saved, ...authResponse.getJson(), createdAt: Date.now() };
    await tokenStore.save(fresh);
    console.log('[qbo] access token refreshed');
    return fresh;
  } catch (err) {
    console.error('[qbo] refresh failed:', err.error_description || err.message);
    throw new TokenExpiredError();
  }
}

// Returns { access_token, realmId, ... } that is safe to use right now.
async function getValidToken() {
  const saved = await tokenStore.load();
  if (!saved || !saved.refresh_token || !saved.realmId) throw new NotConnectedError();
  if (isAccessTokenExpired(saved)) return refreshTokens(saved);
  return saved;
}

async function disconnect() {
  const saved = await tokenStore.load();
  if (saved) {
    try {
      oauthClient.setToken(saved);
      await oauthClient.revoke({ refresh_token: saved.refresh_token });
    } catch (err) {
      // Best effort: even if Intuit's revoke call fails we still forget the tokens locally.
      console.warn('[qbo] revoke failed (ignored):', err.message);
    }
  }
  await tokenStore.clear();
}

// ---------- Raw API calls ----------
// GET {API_BASE}/v3/company/{realmId}/{path}
async function qboGet(path, params = {}, isRetry = false) {
  const token = await getValidToken();
  const url = new URL(`${API_BASE}/v3/company/${token.realmId}/${path}`);
  url.searchParams.set('minorversion', MINOR_VERSION);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    });
  } catch (err) {
    throw new QboApiError(`Could not reach QuickBooks (${err.message}). Check your internet connection.`, 503);
  }

  // 401 = access token rejected (expired early / revoked). Refresh once and retry.
  if (res.status === 401 && !isRetry) {
    await refreshTokens(token);
    return qboGet(path, params, true);
  }

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { text }; }

  if (!res.ok || body.Fault) {
    if (res.status === 401) throw new TokenExpiredError();
    // QBO errors look like { Fault: { Error: [{ Message, Detail, code }] } }
    const e = body.Fault?.Error?.[0] || body.fault?.error?.[0];
    const msg = e
      ? `QuickBooks API error: ${e.Message || e.message}${e.Detail || e.detail ? ` – ${e.Detail || e.detail}` : ''}`
      : `QuickBooks API error (HTTP ${res.status})`;
    throw new QboApiError(msg, res.status >= 400 ? res.status : 502, body);
  }
  return body;
}

// Run a query like "SELECT * FROM Account WHERE ...", following pagination.
// QBO pages with STARTPOSITION (1-based) and MAXRESULTS (max 1000).
//   entity: 'Account', 'Purchase', ...
//   opts.where:   optional WHERE clause (without the word WHERE)
//   opts.orderBy: optional ORDERBY clause
//   opts.limit:   stop after this many rows (e.g. 50 latest transactions)
// Returns { rows, rawPages } – rawPages are the untouched API responses.
async function query(entity, opts = {}) {
  const { where, orderBy, limit = Infinity } = opts;
  const rows = [];
  const rawPages = [];
  let start = 1;

  while (rows.length < limit) {
    const pageSize = Math.min(PAGE_SIZE, limit - rows.length);
    let sql = `SELECT * FROM ${entity}`;
    if (where) sql += ` WHERE ${where}`;
    if (orderBy) sql += ` ORDERBY ${orderBy}`;
    sql += ` STARTPOSITION ${start} MAXRESULTS ${pageSize}`;

    const body = await qboGet('query', { query: sql });
    rawPages.push(body);
    const page = body.QueryResponse?.[entity] || []; // empty result => key is missing entirely
    rows.push(...page);

    if (page.length < pageSize) break; // last page reached
    start += page.length;
  }
  return { rows, rawPages };
}

// ---------- Typed helpers used by the routes ----------
async function getCompanyInfo() {
  const token = await getValidToken();
  const body = await qboGet(`companyinfo/${token.realmId}`);
  const info = body.CompanyInfo;
  // Remember the company name so the home page can show it without an API call.
  await tokenStore.save({ ...(await tokenStore.load()), companyName: info.CompanyName });
  return { info, raw: body };
}

const getAccounts = () => query('Account', { orderBy: 'Name' });
const getBankAccounts = () => query('Account', { where: "AccountType = 'Bank'", orderBy: 'Name' });
const getClasses = () => query('Class', { orderBy: 'Name' });

const TXN_TYPES = ['Purchase', 'Deposit', 'Invoice', 'JournalEntry'];

// Last 50 of each transaction type, newest first.
async function getTransactions() {
  const transactions = [];
  const raw = {};
  for (const type of TXN_TYPES) {
    const { rows, rawPages } = await query(type, { orderBy: 'TxnDate DESC', limit: 50 });
    raw[type] = rawPages;
    transactions.push(...rows.map((t) => normalizeTxn(type, t)));
  }
  transactions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { transactions, raw };
}

// ---------- Normalizing ----------
// Each transaction type stores account/class in different places. This flattens them to:
// { id, type, date, amount, account, class, accounts[], classes[], docNumber }
const unique = (arr) => [...new Set(arr.filter(Boolean))];

function normalizeTxn(type, t) {
  const lines = t.Line || [];
  let accounts = [];
  let classes = [];
  let amount = t.TotalAmt;

  if (type === 'Purchase') {
    // Header AccountRef = the bank/credit card the money came from; lines = expense accounts.
    accounts = [t.AccountRef?.name];
    for (const l of lines) {
      const d = l.AccountBasedExpenseLineDetail || l.ItemBasedExpenseLineDetail || {};
      accounts.push(d.AccountRef?.name);
      classes.push(d.ClassRef?.name);
    }
  } else if (type === 'Deposit') {
    accounts = [t.DepositToAccountRef?.name];
    for (const l of lines) {
      const d = l.DepositLineDetail || {};
      accounts.push(d.AccountRef?.name);
      classes.push(d.ClassRef?.name);
    }
  } else if (type === 'Invoice') {
    accounts = [t.ARAccountRef?.name || 'Accounts Receivable'];
    classes.push(t.ClassRef?.name); // invoice may have a header-level class
    for (const l of lines) classes.push(l.SalesItemLineDetail?.ClassRef?.name);
  } else if (type === 'JournalEntry') {
    // A JE has no TotalAmt in older minor versions; use the sum of the debit lines.
    let debits = 0;
    for (const l of lines) {
      const d = l.JournalEntryLineDetail;
      if (!d) continue;
      accounts.push(d.AccountRef?.name);
      classes.push(d.ClassRef?.name);
      if (d.PostingType === 'Debit') debits += Number(l.Amount) || 0;
    }
    if (amount == null) amount = debits;
  }

  accounts = unique(accounts);
  classes = unique(classes);
  return {
    id: t.Id,
    type,
    docNumber: t.DocNumber || '',
    date: t.TxnDate,
    amount: amount == null ? null : Number(amount),
    account: accounts.join(', '),
    class: classes.join(', '),
    accounts,
    classes,
  };
}

module.exports = {
  API_BASE,
  hasKeys,
  getAuthorizeUrl,
  handleCallback,
  getValidToken,
  disconnect,
  qboGet,
  query,
  getCompanyInfo,
  getAccounts,
  getBankAccounts,
  getClasses,
  getTransactions,
  normalizeTxn,
  TXN_TYPES,
  NotConnectedError,
  TokenExpiredError,
  QboApiError,
};
