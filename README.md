# SUI Budget Control

A budget analysis dashboard for SAP funds centre exports.

An administrator uploads a funds centre report (`.xlsx`, `.xls`, or delimited
text) exported from SAP. The backend parses it in memory, infers the column
layout, rebuilds the category → commitment-item hierarchy from the leading
account codes, reconciles every subtotal against its lines, and stores the
resulting normalized model in MongoDB. Everyone else drills through that model
in an Angular dashboard and exports any slice of it as CSV.

Authentication and authorization are delegated to **CAAS One**: the app holds no
user accounts of its own, and permissions come from the roles assigned to a user
against the `sui-budget-control` app in CAAS One Admin.

## Prerequisites

- **Node.js 20+** and npm
- **MongoDB** running locally on `mongodb://localhost:27017`
- **CAAS One** running locally — web on `:3500`, API on `:3501`
- A modern browser (the UI is built on Fluent 2 web components)

## Folder structure

```
sui-budget-control/
├── backend/       NestJS API (port 3000, all routes under /api)
│   ├── src/auth/        CAAS One session exchange, cookie handling
│   ├── src/caas/        CAAS One HTTP client (/users/me, /roles/my, check-access)
│   ├── src/common/      @RequirePermission decorator + guard
│   ├── src/datasets/    Dataset CRUD, CSV export, Mongoose schema
│   ├── src/parser/      Workbook reader, column inference, reconciliation
│   └── src/features.ts  Feature/action catalog — mirrors the CAAS One seed
├── web/           Angular 19 SPA (port 4200, proxies /api to the backend)
│   ├── src/app/core/      Auth + API services, guards, drill-down helpers
│   └── src/app/features/  Dashboard, upload wizard, no-access page
├── index.html     Original single-file prototype, kept for reference only.
│                  It is not built, served, or wired to the backend — the
│                  Angular app in web/ is the real implementation.
└── README.md
```

## Backend environment variables

Copy `backend/.env.example` to `backend/.env` and adjust as needed. Defaults in
parentheses apply when the variable is unset.

| Variable | Purpose |
| --- | --- |
| `PORT` | Port the API listens on (`3000`) |
| `MONGODB_URI` | Budget database (`mongodb://localhost:27017/sui-budget-control`) |
| `FRONTEND_URL` | Allowed CORS origin and post-login redirect target (`http://localhost:4200`) |
| `CAAS_WEB_URL` | CAAS One web app, where users are sent to sign in (`http://localhost:3500`) |
| `CAAS_API_URL` | CAAS One API base, including `/api` (`http://localhost:3501/api`) |
| `CAAS_APP_KEY` | App key registered in CAAS One (`sui-budget-control`) |
| `SESSION_COOKIE_NAME` | Name of the httpOnly session cookie (`sbc_session`) |
| `AUTH_CALLBACK_PUBLIC_URL` | Callback URL registered with CAAS One (`http://localhost:4200/api/auth/callback`) |
| `MAX_UPLOAD_BYTES` | Upload size ceiling (`20971520`, i.e. 20 MB) |
| `CAAS_REQUEST_TIMEOUT_MS` | Timeout on calls to CAAS One (`15000`) |
| `NODE_ENV` | `production` marks the session cookie `secure` |

The callback URL points at **port 4200**, not 3000: the browser lands on the
Angular dev server, which proxies `/api` through to the backend. That keeps the
session cookie same-origin with the SPA.

## Setup

### 1. Seed CAAS One

From the **CAAS One** repository root, register the app, its feature, and its
roles:

```bash
npm run db:seed:budget
```

This runs `apps/api/src/seed-budget.ts`, which is idempotent — re-run it
whenever the feature or role definitions change. It:

- registers (or confirms) the `sui-budget-control` app with base URL
  `http://localhost:4200/api/auth/callback`
- seeds the `budget` feature (module `Budget`, actions `view`, `create`,
  `export`)
- creates the `budget-admin` and `budget-viewer` roles
- grants `budget-admin` to the emails in `BUDGET_ADMIN_EMAILS`
  (defaults to `frazghuman@gmail.com`)

Override the defaults with `BUDGET_APP_BASE_URL` and `BUDGET_ADMIN_EMAILS` if
your setup differs.

The seed writes to whatever `MONGODB_URI` the CAAS One root `.env` points at,
which is a separate database from this app's own `sui-budget-control` database.

### 2. Assign roles in CAAS One Admin

Go to **Admin → Users → Manage apps**, pick a user, add **SUI Budget Control**,
and choose a role:

| Role | `budget` actions | What the user can do |
| --- | --- | --- |
| `budget-admin` | `view`, `create`, `export` | Upload SAP exports, view every dataset, export CSV |
| `budget-viewer` | `view`, `export` | View datasets and export CSV — **cannot upload** |

`budget-viewer` is the default role, so a user added to the app without an
explicit choice lands on read-only access. CAAS One platform admins bypass the
role check and get every action.

### 3. Run the backend

```bash
cd backend
npm install
cp .env.example .env      # first time only
npm run start:dev
```

The API listens on `http://localhost:3000/api`.

### 4. Run the frontend

```bash
cd web
npm install
npm start
```

The SPA is served from `http://localhost:4200` and proxies `/api` to port 3000
via `proxy.conf.json`, so both the session cookie and the API share an origin.

Open `http://localhost:4200` — unauthenticated visitors are redirected through
the CAAS One login flow and returned to the page they asked for.

## API

All routes are prefixed with `/api`.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/auth/login?returnTo=` | — | Redirects to the CAAS One login page |
| `GET` | `/auth/callback?caas_token=` | — | Exchanges the token for a session cookie |
| `GET` | `/auth/session` | — | Current session and permission flags |
| `POST` | `/auth/logout` | — | Clears the session cookie |
| `GET` | `/datasets` | `budget:view` | Dataset summaries, newest first |
| `GET` | `/datasets/:id` | `budget:view` | One dataset with its full parsed model |
| `POST` | `/datasets/inspect` | `budget:create` | Parses and validates without saving |
| `POST` | `/datasets/import` | `budget:create` | Parses and persists |
| `GET` | `/datasets/:id/export?categoryIndex=` | `budget:export` | CSV download |

`inspect` and `import` take a multipart body with the file under the field
`file`, plus optional `sheetIdx` (a sheet number) and `map` (a JSON string of
`{ label, consumable, consumed, available }` column indices). `import` requires
`map`, so the usual flow is inspect first, confirm the inferred mapping, then
import.

`GET /auth/session` returns:

```json
{
  "authenticated": true,
  "user": { "sub": "...", "email": "...", "userType": "...", "displayName": "..." },
  "roles": [{ "key": "budget-admin", "name": "Budget Admin" }],
  "permissions": [{ "featureKey": "budget", "actions": ["view", "create", "export"] }],
  "canView": true,
  "canUpload": true,
  "canExport": true
}
```

The three boolean flags are what the Angular route guards read: `canUpload`
maps to `budget:create`, so viewers never reach the upload wizard.

## Persistence

Only the **normalized model** is stored, in the `datasets` collection of
MongoDB. Uploaded files are parsed in memory and the bytes are discarded — there
is no raw file storage, no upload directory, and no object store to configure or
back up. A dataset document holds the category tree, the line items, the
reconciliation findings, the detected column map, and who imported it. Re-import
the source file if you need it again.

## Tests and builds

```bash
cd backend && npm test && npm run build     # Jest unit tests, Nest build
cd web && npm run test:ci && npx ng build   # Karma headless tests, prod build
```
