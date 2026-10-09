// Simple "exception" rules run over normalized transactions (see normalizeTxn in services/quickbooks.js).
// Each rule is { id, label, test(txn) -> boolean }. Add your own by appending to RULES.
const RULES = [
  {
    id: 'no_class',
    label: 'Transaction has no Class',
    test: (t) => t.classes.length === 0,
  },
  {
    id: 'uncategorized',
    label: 'Uses an Uncategorized account',
    // Matches "Uncategorized Expense", "Uncategorized Income", "Uncategorised Asset", ...
    test: (t) => t.accounts.some((name) => /uncategori[sz]ed/i.test(name)),
  },
  {
    id: 'zero_amount',
    label: 'Zero or missing amount',
    test: (t) => t.amount == null || Number.isNaN(t.amount) || t.amount === 0,
  },
];

// Returns { rules: [{id,label,count}], items: [txn + { rulesHit: [labels] }], checked }
function runRules(transactions) {
  const counts = Object.fromEntries(RULES.map((r) => [r.id, 0]));
  const items = [];

  for (const txn of transactions) {
    const hit = RULES.filter((r) => r.test(txn));
    if (hit.length === 0) continue;
    hit.forEach((r) => counts[r.id]++);
    items.push({ ...txn, rulesHit: hit.map((r) => r.label) });
  }

  return {
    checked: transactions.length,
    rules: RULES.map((r) => ({ id: r.id, label: r.label, count: counts[r.id] })),
    items,
  };
}

module.exports = { runRules, RULES };
