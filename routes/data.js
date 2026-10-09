// JSON API used by the HTML pages. Every response includes `raw` = the untouched QBO response,
// so the "Show raw JSON" toggle on each page lets you study the real API.
const express = require('express');
const qbo = require('../services/quickbooks');
const { runRules } = require('../rules/exceptions');
const store = require('../services/store');

const router = express.Router();

// Result of the last "Sync all" is saved under this key (lastSync.json locally, Redis on Vercel).
const LAST_SYNC = 'lastSync';

// Wraps an async handler so any thrown error becomes a readable JSON error.
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    console.error(`[api] ${req.method} ${req.path}:`, err.message);
    res.status(err.status || 500).json({
      error: err.message || 'Unexpected error',
      kind: err.kind || 'server',
      raw: err.raw,
    });
  }
};

// Flatten an Account object into a table row.
const accountRow = (a) => ({
  id: a.Id,
  name: a.FullyQualifiedName || a.Name,
  type: a.AccountType,
  subtype: a.AccountSubType,
  balance: a.CurrentBalance,
  active: a.Active,
});

router.get('/company', handle(async () => {
  const { info, raw } = await qbo.getCompanyInfo();
  const addr = info.CompanyAddr || {};
  return {
    company: {
      'Company name': info.CompanyName,
      'Legal name': info.LegalName,
      Country: info.Country,
      Address: [addr.Line1, addr.City, addr.CountrySubDivisionCode, addr.PostalCode].filter(Boolean).join(', '),
      Email: info.Email?.Address,
      Phone: info.PrimaryPhone?.FreeFormNumber,
      'Fiscal year start month': info.FiscalYearStartMonth,
      'Company start date': info.CompanyStartDate,
      'Realm ID': info.Id,
    },
    raw,
  };
}));

router.get('/accounts', handle(async () => {
  const { rows, rawPages } = await qbo.getAccounts();
  return { rows: rows.map(accountRow), raw: rawPages };
}));

router.get('/bank-accounts', handle(async () => {
  const { rows, rawPages } = await qbo.getBankAccounts();
  return { rows: rows.map(accountRow), raw: rawPages };
}));

router.get('/classes', handle(async () => {
  const { rows, rawPages } = await qbo.getClasses();
  return {
    rows: rows.map((c) => ({ id: c.Id, name: c.FullyQualifiedName || c.Name, active: c.Active, subClass: c.SubClass })),
    raw: rawPages,
  };
}));

router.get('/transactions', handle(async () => {
  const { transactions, raw } = await qbo.getTransactions();
  return { rows: transactions, raw };
}));

// Exceptions use the last sync if there is one, otherwise fetch transactions now.
router.get('/exceptions', handle(async () => {
  const lastSync = await store.get(LAST_SYNC);
  let transactions = lastSync?.transactions;
  let source = lastSync ? `last sync (${lastSync.timestamp})` : 'live fetch (no sync yet)';
  if (!transactions) transactions = (await qbo.getTransactions()).transactions;
  return { source, ...runRules(transactions) };
}));

// Pull everything once, save it, return a summary. Used by "Sync all" and by the daily cron.
async function runSync() {
  const company = await qbo.getCompanyInfo();
  const accounts = await qbo.getAccounts();
  const classes = await qbo.getClasses();
  const { transactions } = await qbo.getTransactions();

  const counts = {
    Accounts: accounts.rows.length,
    'Bank accounts': accounts.rows.filter((a) => a.AccountType === 'Bank').length,
    Classes: classes.rows.length,
  };
  for (const type of qbo.TXN_TYPES) counts[type] = transactions.filter((t) => t.type === type).length;

  const lastSync = { timestamp: new Date().toISOString(), transactions };
  await store.set(LAST_SYNC, lastSync);
  const exceptions = runRules(transactions);

  return {
    timestamp: lastSync.timestamp,
    companyName: company.info.CompanyName,
    counts,
    exceptionsFound: exceptions.items.length,
  };
}

router.post('/sync', handle(runSync));

router.get('/sync', handle(async () => {
  const lastSync = await store.get(LAST_SYNC);
  return lastSync ? { timestamp: lastSync.timestamp, transactions: lastSync.transactions.length } : null;
}));

// Called by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
// Running regularly also keeps the QuickBooks refresh token in use so the connection stays alive.
router.get('/cron/sync', (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized', kind: 'server' });
  }
  next();
}, handle(runSync));

module.exports = router;
