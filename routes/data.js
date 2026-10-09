// JSON API used by the HTML pages. Every response includes `raw` = the untouched QBO response,
// so the "Show raw JSON" toggle on each page lets you study the real API.
const express = require('express');
const qbo = require('../services/quickbooks');
const { runRules } = require('../rules/exceptions');

const router = express.Router();

// Result of the last "Sync all" (kept in memory; lost on restart).
let lastSync = null;

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
  let transactions = lastSync?.transactions;
  let source = lastSync ? `last sync (${lastSync.timestamp})` : 'live fetch (no sync yet)';
  if (!transactions) transactions = (await qbo.getTransactions()).transactions;
  return { source, ...runRules(transactions) };
}));

// "Sync all": pull everything once, keep it in memory, return a summary.
router.post('/sync', handle(async () => {
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

  lastSync = { timestamp: new Date().toISOString(), transactions };
  const exceptions = runRules(transactions);

  return {
    timestamp: lastSync.timestamp,
    companyName: company.info.CompanyName,
    counts,
    exceptionsFound: exceptions.items.length,
  };
}));

router.get('/sync', (req, res) => {
  res.json(lastSync ? { timestamp: lastSync.timestamp, transactions: lastSync.transactions.length } : null);
});

module.exports = router;
