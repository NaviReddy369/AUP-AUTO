# AUP Auto

A small learning demo that connects to a **QuickBooks Online sandbox** company with OAuth 2.0 and shows its data in clean tables, with a raw-JSON view on every page so you can study the real API responses.

Stack: Node.js + Express, `intuit-oauth`, `dotenv`, plain HTML/CSS/JS.

## 1. Create a sandbox app at Intuit

1. Sign in at <https://developer.intuit.com> → **My Hub → App dashboard** → create an app (QuickBooks Online and Payments). Choose the **com.intuit.quickbooks.accounting** scope.
2. Open the app → **Keys & credentials** → use the **Development** keys. Those are the sandbox keys.
3. Under **Redirect URIs** (Development), add exactly:
   ```
   http://localhost:3000/callback
   ```
   It must match `REDIRECT_URI` in `.env` character for character: `http`, no trailing slash.
4. A sandbox company is created automatically for your developer account (**My Hub → Sandboxes**). It is pre-filled with sample data.

## 2. Configure

Copy `.env.example` to `.env` (a blank `.env` is already included) and fill in:

```
CLIENT_ID=your development client id
CLIENT_SECRET=your development client secret
REDIRECT_URI=http://localhost:3000/callback
PORT=3000
```

`.env`, `node_modules/` and `tokens.json` are git-ignored. Never commit your secrets.

## 3. Run

```bash
npm install
node server.js
```

Open <http://localhost:3000>, click **Connect QuickBooks**, sign in, pick your sandbox company and click **Connect**.

## Pages

| Page | What it calls |
|---|---|
| Home | Connection status, Connect / Disconnect, **Sync all** summary |
| Company | `GET /companyinfo/{realmId}` |
| Chart of Accounts | `SELECT * FROM Account` (name, type, subtype, balance) |
| Bank Accounts | `SELECT * FROM Account WHERE AccountType = 'Bank'` |
| Classes | `SELECT * FROM Class` |
| Transactions | Last 50 each of `Purchase`, `Deposit`, `Invoice`, `JournalEntry` |
| Exceptions | Rules: no Class, Uncategorized account, zero/missing amount |

Each data page has a **Show raw JSON** button.

## How it works

```
server.js                 Express setup, loads .env, mounts routes and static files
routes/auth.js            /connect, /callback (checks state), /disconnect, /api/status
routes/data.js            /api/company, /api/accounts, /api/bank-accounts, /api/classes,
                          /api/transactions, /api/exceptions, POST /api/sync
services/quickbooks.js    OAuth client, token auto-refresh, API calls, query pagination,
                          transaction normalizing
services/tokenStore.js    Saves tokens + realmId to tokens.json
rules/exceptions.js       The exception rules (add your own to the RULES array)
public/                   HTML pages + app.js (shared helpers) + style.css
```

**The OAuth flow**
1. `/connect` creates a random `state` and redirects to Intuit's consent screen.
2. Intuit redirects to `/callback?code=…&state=…&realmId=…`. The server checks that `state` matches, then exchanges `code` for tokens.
3. The tokens and `realmId` (the company id) are saved to `tokens.json`, so restarting the server keeps you connected.

**Tokens:** an access token lasts about 1 hour and a refresh token about 100 days. Before each API call, `getValidToken()` refreshes the access token if it expires within 60 seconds. If QBO still returns 401, the app refreshes and retries once. If the refresh token itself is dead, you see "connection expired, please reconnect".

**Pagination:** QBO queries return at most 1000 rows. `query()` repeats the query with `STARTPOSITION 1, 1001, 2001…` until a page comes back short.

**Sync all** keeps the result in memory. The Exceptions page uses the last sync, or fetches fresh data if you haven't synced since the server started.

## Troubleshooting

| Message | Fix |
|---|---|
| `Missing CLIENT_ID …` | Fill in `.env` and restart the server |
| Intuit page says *redirect_uri is invalid* | Add `http://localhost:3000/callback` to the app's **Development** redirect URIs |
| `Invalid OAuth state` | Click Connect again. This happens if the server restarted mid-login |
| `Token exchange failed: invalid_client` | Wrong client id or secret, or you used production keys instead of development keys |
| `connection expired` | Click Connect QuickBooks again |
