# REW Staffware — Web Platform

Web replacement for the StaffWareDesign.accdb Access front end. It uses the same SQL Server database (`StaffwareSample`) and the same `LoginUsers` logins and module permissions.

New to the software? See the [simple StaffWare user guide with workflow diagrams](docs/APP_OVERVIEW.md).

```
web code/
  server/   Node.js + Express API (talks to SQL Server via Windows auth, ODBC Driver 17)
  client/   React (Vite) front end
```

## Run it (development)

Open two terminals:

```
cd "C:\Republic electric west\web code\server"
npm run dev            # API on http://localhost:4000

cd "C:\Republic electric west\web code\client"
npm run dev            # UI on http://localhost:5173 (proxies /api to :4000)
```

Log in with `devtest` / `xxxx` (all sample users also use `xxxx`).

## Run it (single server)

```
cd client && npm run build
cd ../server && npm start      # serves the UI and API on http://localhost:4000
```

## Configuration — `server/.env`

| Key | Meaning |
|---|---|
| `DB_CONNECTION` | ODBC connection string. Default: `localhost`, database `StaffwareSample`, Windows auth |
| `JWT_SECRET` | Random secret (≥32 chars) that signs login sessions. Generated locally; generate a new one per server. The server refuses to start in PROD with a weak value. |
| `APP_ENV` | `DEMO` or `PROD`. PROD adds HSTS and the Secure cookie flag and enforces a strong secret |
| `ALLOWED_ORIGINS` | Extra browser origins allowed to call the API (comma separated). Same-origin always works |
| `COOKIE_SECURE` | `1` when served over HTTPS outside PROD |
| `TRUST_PROXY` | Set (e.g. `1`) when behind IIS / a reverse proxy so client IPs are correct for login throttling |
| `PORT` | API port (default 4000) |

## Module status

| Code | Module | Status |
|---|---|---|
| AM | Alarm Monitoring | ✅ Accounts (search/filter/sort/paging, create/edit/delete), call-list contacts, zones, renewals-due report, dashboard |
| PR | Payroll | ✅ Piece timecard, hourly timecard, append hourly, post payroll (→ PrLaborPaid + JcLotItem), timecards review, employees, pay periods, labor-paid reports + CSV |
| JS, SC, FM, TM, IC, PO, MG | Job setup, Scheduling, Foreman, T&M, Inventory, Purchasing, Management | ✅ |
| AR | Accounts receivable | ✅ Process billing, post billing, invoices, Fix billing code, snapshot-in-use; all 18 Access reports on one card-style Reports page (like Management) (see [docs/AR_ACCESS_TO_WEB_MAP.md](docs/AR_ACCESS_TO_WEB_MAP.md)) |
| CS | Customer service | ✅ Homeowners, properties, tickets/appointments (techs, findings, material), schedule + calendar, quotes, call notes, setup, 20 reports |
| PM | Plan management | ✅ Customers/jobs/bids, plans, packs, material & values, copy/bulk edit, price updates, 12 reports |
| ES | Estimating | ✅ Customers/jobs/bids, plans, assemblies, option packs, material bids, transfer to PM, master assemblies, items, research, job log, 3 reports |
| CM | Contract management | ✅ Contracts, addenda, diary, bid links, contract values, revised contract values, latest changes, 20 reports |
| SA | Sales | ✅ Leads with homeowners and phones, 8 reports |
| CX | Cox cable | ✅ Jobs, assessors, plans, material, items, billing info, material requests, billing runs, 12 reports |
| PU | Public | ✅ Lot finder, job lists, lot and plan data, start-pack labor (11 reports, every user) |
| DM | Database maintenance | ✅ Logins and permissions (passwords never returned), 42 lookup lists, data-fix screens, posting and price tools |

Business rules are taken from the Access front end (`StaffWareDesign.accdb`): forms, macros and queries were exported
as text and each web action follows the same queries (e.g. Payroll follows macros `PrTimecard`, `PrSubmitHourly`,
`PrTimecardAppendHourly`, `PrTimecardPost`). The newer `PrN*` payroll macros are disabled in Access and were not copied.

## Database migrations — `db/`

Run in order (001–013) against the target database. `001_fix_sample_column_types.sql` fixes wrongly typed columns in the
**local sample** (JcLotItem.PackId/PayPercent/Hours were BIT; PrTempPayroll.PlanNum was INT). Confirm production types
with Eric before running anything there.

## Security

- **Session**: login sets an HttpOnly, SameSite=Strict cookie (`sw_session`, path /api). Scripts and DevTools storage cannot read it; nothing secret is kept in localStorage. Log out revokes the token on the server.
- **Access re-checked live**: every request re-reads the user's LoginUsers row (30 s cache), so deactivating a login or removing a module takes effect at once. Module permissions are enforced by the API, not just hidden in the menu.
- **API only answers the app**: requests need the `X-Staffware-Client` header and a same-site origin. Cross-site requests, other web sites and pasted /api URLs are refused (403). CORS is off.
- **Login throttling**: 10 failed attempts per username / 30 per IP → locked for 15 minutes.
- **Headers**: strict Content-Security-Policy, X-Frame-Options DENY, nosniff, no-referrer, no-store on API responses, HSTS in PROD, no X-Powered-By.
- **Errors**: server/SQL errors return only "Something went wrong (ref xxxx)"; the details go to the server log under that ref.
- **SQL**: all user input is passed as parameters; dynamic ORDER BY values come from fixed allow-lists.
- **Front-end code**: `npm run build` emits no source maps, strips console/debugger, and obfuscates the app's own code (`vite.config.js`). `npm run dev` is not obfuscated — never expose the dev server.
- **Limits (by design of the web)**: a signed-in user's own browser always receives the data they're allowed to see — the Network tab will show it, and a user who has a valid login can call the API with their own credentials. What they can see is limited by their module permissions. Obfuscation slows down reading the code; it can't make it impossible.
- **Still to do before go-live**: serve over HTTPS; hash `LoginUsers.Password` (plain text today, shared with the Access front end).

## Notes and known issues

- Staffware tables have **no IDENTITY columns**. New IDs are allocated as `MAX+1` inside a serializable transaction (`server/src/db.js → nextId`).
- `DateEntered` / `UserEntered` are stamped automatically on insert.
- `LoginUsers.Password` is stored in **plain text** (legacy design). The web app checks it as-is for now. Hashing it should happen before go-live.
- Lookup values that exist in the data but not in a lookup table (e.g. phone type "Cellular") are kept when you edit a row.
"# Republic-Electic-West" 
