// Shared front-end helpers used by every page.

// Top navigation bar – injected into <nav id="nav"></nav> on each page.
const PAGES = [
  ['/', 'Home'],
  ['/company.html', 'Company'],
  ['/accounts.html', 'Chart of Accounts'],
  ['/bank.html', 'Bank Accounts'],
  ['/classes.html', 'Classes'],
  ['/transactions.html', 'Transactions'],
  ['/exceptions.html', 'Exceptions'],
];

function renderNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const here = location.pathname === '/index.html' ? '/' : location.pathname;
  nav.innerHTML =
    '<span class="brand">AUP Auto</span>' +
    PAGES.map(([href, label]) => `<a href="${href}" class="${href === here ? 'active' : ''}">${label}</a>`).join('');
}

// Escape text before putting it into HTML (QBO data could contain < or &).
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const money = (n) =>
  n == null || n === '' ? '' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// fetch() wrapper: returns parsed JSON or throws an Error carrying the server's message + kind.
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.kind = data.kind;
    err.raw = data.raw;
    throw err;
  }
  return data;
}

// Red banner at the top of the page. Offers a Connect link for auth problems.
function showError(err) {
  const box = document.getElementById('error');
  const needsConnect = err.kind === 'not_connected' || err.kind === 'expired';
  box.innerHTML = esc(err.message) + (needsConnect ? ' <a href="/connect">Connect QuickBooks</a>' : '');
  box.hidden = false;
}

// columns: [{ key, label, format?(value,row), className? }]
function renderTable(el, columns, rows) {
  if (!rows.length) {
    el.innerHTML = '<p class="muted">No records found.</p>';
    return;
  }
  const head = columns.map((c) => `<th class="${c.className || ''}">${esc(c.label)}</th>`).join('');
  const body = rows
    .map((r) => '<tr>' + columns.map((c) => {
      const v = c.format ? c.format(r[c.key], r) : esc(r[c.key]);
      return `<td class="${c.className || ''}">${v}</td>`;
    }).join('') + '</tr>')
    .join('');
  el.innerHTML = `<p class="muted">${rows.length} record(s)</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// "Show raw JSON" button + <pre>. Call with the raw API response once it has loaded.
function setupRawToggle(raw) {
  const btn = document.getElementById('rawBtn');
  const pre = document.getElementById('raw');
  if (!btn || !pre) return;
  pre.textContent = JSON.stringify(raw, null, 2);
  btn.hidden = false;
  btn.onclick = () => {
    pre.hidden = !pre.hidden;
    btn.textContent = pre.hidden ? 'Show raw JSON' : 'Hide raw JSON';
  };
}

// Common flow for a data page: call the API, render a table, wire the raw toggle.
async function loadTablePage(url, columns) {
  const content = document.getElementById('content');
  content.innerHTML = '<p class="muted">Loading from QuickBooks…</p>';
  try {
    const data = await fetchJson(url);
    renderTable(content, columns, data.rows);
    setupRawToggle(data.raw);
  } catch (err) {
    content.innerHTML = '';
    showError(err);
    if (err.raw) setupRawToggle(err.raw);
  }
}

// Column formatters reused across pages.
const fmt = {
  money: (v) => esc(money(v)),
  bool: (v) => (v ? 'Yes' : 'No'),
  missing: (v) => (v ? esc(v) : '<span class="flag">—</span>'),
};

document.addEventListener('DOMContentLoaded', renderNav);
