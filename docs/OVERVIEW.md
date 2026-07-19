# Ads MVP Report — Project Overview

**Last Updated:** 2026-04-17  
**Version:** 0.1.0

## Project Purpose

Ads MVP Report is a minimal, self-contained Google Ads reporting dashboard that automates three core processes:

1. **Data Ingestion** — Pull campaign performance data from Google Ads API into PostgreSQL
2. **Data Export** — Write processed data to Google Sheets (either via scheduled configs or manual ad-hoc exports)
3. **Scheduling** — Automatic daily runs with configurable catchup and refresh windows

The system serves as a bridge between Google Ads (source of truth for daily performance) and Google Sheets (where clients/analysts review and report on data).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React + Ant Design)            │
│  - Dashboard with 6 pages (Overview, Accounts, Campaigns,   │
│    Ingestion, Sheets, Scheduler)                             │
│  - Real-time progress bars for active ingestion/export runs  │
│  - Config management for Sheets exports                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (authenticated)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│          Backend API (Express.js + Node.js)                  │
│                     Port 4010 (default)                      │
├─────────────────────────────────────────────────────────────┤
│ • Auth Module         — Google OAuth 2.0, session mgmt      │
│ • Google Module       — MCC account sync, credentials       │
│ • Campaigns Module    — Campaign discovery & sync           │
│ • Ingestion Module    — Google Ads API → DB                 │
│ • Sheets Module       — DB → Google Sheets                  │
│ • Scheduler Module    — Cron-like tick-based orchestration  │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
│   PostgreSQL    │ │ Google Ads   │ │ Google Sheets    │
│   (Local DB)    │ │ API (v21)    │ │ Spreadsheets API │
│                 │ │              │ │                  │
│ • Accounts      │ │ • Campaign   │ │ • Write rows     │
│ • Campaigns     │ │   metrics    │ │ • Upsert cells   │
│ • Daily Facts   │ │ • Refresh    │ │ • Manage headers │
│ • Configs       │ │   tokens     │ │                  │
│ • Run History   │ │              │ │                  │
└─────────────────┘ └──────────────┘ └──────────────────┘
```

### Technology Stack

**Backend:**
- **Framework:** Express.js (Node.js)
- **ORM:** Prisma 6.6+
- **Database:** PostgreSQL 12+
- **HTTP Client:** Axios
- **Logging:** Pino + Pino-HTTP
- **Validation:** Zod
- **Auth:** Google OAuth 2.0, Express session cookies

**Frontend:**
- **Framework:** React 18+
- **UI Library:** Ant Design (5.x)
- **HTTP Client:** Native fetch
- **Code Splitting:** React.lazy + Suspense
- **Styling:** Ant Design CSS

**Deployment (Optional):**
- **Container:** Docker
- **Reverse Proxy:** Traefik (for production)

**Language:** TypeScript (backend + frontend)

---

## Data Flow

### Ingestion Pipeline

```
┌─────────────────┐
│ Manual Request  │
│ or Scheduler    │
│   Daily Tick    │
└────────┬────────┘
         │
         ▼
    ┌─────────────────────────────┐
    │ Start Ingestion Run          │
    │ - Generate run date/period   │
    │ - Lock (prevent concurrent)  │
    │ - Fetch eligible accounts    │
    └────────┬────────────────────┘
             │
             ▼
    ┌─────────────────────────────┐
    │ For Each Account (parallel)  │
    │ - Get Google Ads credentials │
    │ - Query GAQL for campaign    │
    │   metrics (date range)       │
    │ - Parse response             │
    └────────┬────────────────────┘
             │
             ▼
    ┌─────────────────────────────┐
    │ Upsert CampaignDailyFact     │
    │ - Unique key: (date, acct,   │
    │   campaign)                  │
    │ - Store: impressions, clicks,│
    │   cost, conversions, ROAS    │
    └────────┬────────────────────┘
             │
             ▼
    ┌─────────────────────────────┐
    │ Mark Run as SUCCESS/FAILED   │
    │ - Update account progress    │
    │ - Log errors                 │
    └─────────────────────────────┘
```

### Export to Sheets Pipeline

```
┌────────────────────────────┐
│ Manual Export or Scheduler  │
│ Sheets Tick                 │
└────────┬───────────────────┘
         │
         ▼
    ┌──────────────────────────┐
    │ Load Active Configs       │
    │ or Manual Parameters      │
    │ (account, sheet, columns) │
    └────────┬─────────────────┘
             │
             ▼
    ┌──────────────────────────┐
    │ Fetch Facts from DB      │
    │ - Apply filters:         │
    │   • Date range           │
    │   • Campaign statuses    │
    │   • Campaign name search │
    │ - Select columns         │
    │ - Compute row hash (for  │
    │   dedup on upsert)       │
    └────────┬─────────────────┘
             │
             ▼
    ┌──────────────────────────┐
    │ Write to Google Sheets   │
    │ - Mode: UPSERT only      │
    │ - Append headers         │
    │ - Batch write rows       │
    │ - Handle quota (backoff) │
    └────────┬─────────────────┘
             │
             ▼
    ┌──────────────────────────┐
    │ Mark Run as SUCCESS/FAIL │
    │ - Log row counts         │
    │ - Track row states (for  │
    │   upsert dedup)          │
    └──────────────────────────┘
```

---

## Core Concepts

### Accounts (from Google Ads MCC)

- **Master Customer ID (MCC):** Provided by user; child accounts synced from here
- **Sync Process:** `POST /campaigns/sync` fetches all active (ENABLED) child accounts
- **Ingestion Control:** Each account can be individually enabled/disabled
- **Sheet Configs:** Account-level configuration for automated Sheets exports

### Campaigns

- **Source:** Google Ads API (discovered during account sync)
- **Tracking:** Campaign ID, name, status (ENABLED, PAUSED, REMOVED)
- **Discovery:** Continuous discovery during ingestion runs (new campaigns auto-added)

### Daily Facts (CampaignDailyFact)

Atomic performance record: one row = one campaign on one date, containing:

**Core Metrics:**
- `impressions` — Count
- `clicks` — Count
- `ctrPercent` — Click-through rate (computed or from API)
- `averageCpc` — Cost per click
- `cost` — Total spend (in account currency)
- `conversions` — Count
- `costPerConversion` — CPA (cost ÷ conversions)

**New Metrics (Conversion Value):**
- `conversionValue` — Total value of conversions (from `metrics.conversions_value` in GAQL)
- `conversionValuePerCost` — ROAS: return on ad spend (conversionValue ÷ cost)

**Campaign Info:**
- `campaignId`, `campaignName`, `campaignStatus`
- `finalUrlSuffix`, `trackingUrlTemplate`
- UTM parameters (extracted from URL suffix, if present)

**Uniqueness:** Unique key is `(factDate, adsAccountId, campaignId)` — prevents duplicate facts

### Run History

Two types of "run" records:

1. **IngestionRun** — One attempt to pull data for a date range
   - Status: RUNNING → SUCCESS/FAILED/PARTIAL/CANCELLED
   - Tracks per-account progress via `IngestionAccountRun`

2. **SheetExportRun** — One attempt to write data to Sheets
   - Status: RUNNING → SUCCESS/FAILED/PARTIAL/SKIPPED
   - SKIPPED has two meanings:
     - `rowsPrepared === 0` → No data in DB for that date ("Немає даних")
     - `rowsPrepared > 0` → All rows already up-to-date in Sheet ("Актуально")
   - Links to `AccountSheetConfig` (the destination)

Both track: start/end times, row counts, error summaries.

### Scheduler

Internal tick-based scheduler (not cron):

- **Poll Interval:** `SCHEDULER_POLL_SECONDS` (default 30s)
- **Timezone:** `Europe/Kyiv` (configurable per-deployment via SchedulerSettings.timezone)
- **Logic:** Each tick checks if it's time to run ingestion or sheets based on scheduled hour/minute
- **Catchup:** By default checks `-3, -2, -1` days relative to today (`SCHEDULER_CATCHUP_DAYS`)
- **Refresh:** Also checks latest `SCHEDULER_REFRESH_DAYS` days each run (for late-arriving conversions)
- **Rate Limiting:** `ingestionMaxDailyAttempts`, `sheetsMaxDailyAttempts` prevent runaway retries
- **Per-tick behavior:** Within one tick, the scheduler runs at most ONE successful
  export per loop iteration (`launchedAny=true` only after a successful run). A
  failing config does NOT block the loop from advancing to newer runDates.
- **Stale-RUNNING recovery:** Each tick first calls
  `markStaleIngestionRunsAsFailed` / `markStaleSheetRunsAsFailed` to fail any
  rows left in RUNNING beyond `INGESTION_RUN_STALE_MINUTES` /
  `SHEETS_RUN_STALE_MINUTES` (process-crash recovery).

### Orphan-config protection (added 2026-05-27)

When the underlying Google Ads account for a Sheets config becomes structurally
ineligible (left MCC, became a manager, or `googleStatus=CLOSED`), the next
scheduler run for that config:

1. Records a FAILED `SheetExportRun` with `errorSummary="...not eligible for export"`
2. Reads the current `AdsAccount.isInMcc/isManager/googleStatus`
3. If still structurally broken → sets `AccountSheetConfig.active = false`

Result: the config self-deactivates after one bad run and stops spamming
failed attempts. The user can re-enable it via UI once the account is back
in MCC. Transient failures (OAuth, quota, network) do NOT deactivate the
config — they retry next day per `sheetsMaxDailyAttempts`.

### Token-expiry backfill (added 2026-07-19)

The scheduler's rolling catchup window (`SCHEDULER_CATCHUP_DAYS`) cannot heal
an outage longer than itself: when the Google refresh token expires (7 days in
OAuth Testing mode), ingestion stops and any gap older than the window would
previously stay unfilled forever, forcing a manual full re-pull.

The backfill worker (`src/modules/backfill/backfill.service.ts`, feature-flag
`BACKFILL_ENABLED`) closes such gaps automatically:

1. **Trigger.** When an OAuth re-auth recovers a connection from
   `NEEDS_REAUTH`, the callback route requests a backfill pass (`trigger=REAUTH`).
   A pass can also be requested manually (`POST /scheduler/backfill`, UI button).
2. **Range.** Computed from data, not timers: `from = MAX(factDate) −
   BACKFILL_LOOKBACK_DAYS`, `to = yesterday (Kyiv)`, capped by `BACKFILL_MAX_DAYS`.
3. **Ingestion phase.** Runs day-by-day through the standard
   `runGoogleAdsIngestion` (fresh access token per day, existing retries and
   quota handling). Days that already have a SUCCESS/PARTIAL run are skipped.
4. **Sheets phase.** Exports each day to every active config through the
   standard `runSheetExportConfigById` (UPSERT → no duplicates); days already
   exported are skipped.
5. **Resilience.** State (`BackfillState` singleton: phase + date cursor) lives
   in the DB, so a restart resumes where it left off; the scheduler tick
   re-kicks an in-flight pass every 30s. Quota exhaustion or a token that dies
   mid-pass *pause* the pass without losing the cursor. Transient day failures
   retry up to `BACKFILL_DAY_MAX_ATTEMPTS`, then the cursor moves on.
6. **Anti-spam.** Requesting a pass while one is in flight is an atomic no-op
   (`409`); the UI button is disabled while a pass runs.

The worker runs *outside* the scheduler tick (own async loop, like manual
range runs), so a long catch-up never blocks nightly scheduling. Backfill
ingestion runs are recorded as `MANUAL` so their retries don't consume the
scheduler's `ingestionMaxDailyAttempts`; sheet runs are recorded as
`SCHEDULER` so the nightly tick recognizes exported days as complete.

Paired with `GET /healthz/alert` (503 on `NEEDS_REAUTH` or stale data), the
full recovery story is: monitor alerts → user re-logs in → backfill fills the
DB gap and updates all client spreadsheets, no manual re-pull needed.

---

## Key Workflows

### Manual Ingestion (One-Time)

**Endpoint:** `POST /api/v1/ingestion/runs`

```json
{
  "dateFrom": "2026-04-10",
  "dateTo": "2026-04-15",
  "accountId": "123456789",        // optional: single account only
  "takeAccounts": 5000,            // optional: limit accounts
  "batchSize": 100,                // optional: batch size for API queries
  "enabledOnly": true,             // optional: skip disabled accounts
  "includeInactiveAccounts": false // optional: include SUSPENDED/CANCELED
}
```

Response: `IngestionRun` object with status RUNNING

Frontend polls `GET /api/v1/ingestion/runs/active` to show progress.

### Scheduled Ingestion (Daily)

Scheduler tick runs every 30 seconds:

1. Check if today's run date has a successful ingestion run
2. If not, and if `ingestionEnabled=true`, start one for yesterday
3. Also re-check last `SCHEDULER_REFRESH_DAYS` days to pick up late conversions
4. Respect `ingestionMaxDailyAttempts` to prevent spinning

### Manual Sheets Export (One-Time)

**Endpoint:** `POST /api/v1/sheets/runs/manual`

```json
{
  "accountId": "123456789",
  "spreadsheetId": "1ABC...",
  "sheetName": "April 2026",
  "dataMode": "CAMPAIGN",           // or DAILY_TOTAL
  "columnMode": "ALL",              // or MANUAL
  "selectedColumns": ["date", "campaign_name", "cost", "conversions"],
  "campaignStatuses": ["ENABLED"],  // optional: filter by status
  "campaignNameSearch": "pmax",     // optional: include — case-insensitive substring
  "campaignNameExclude": ["_old", "тест", "archive"], // optional: exclude — any-match excludes
  "runDate": "2026-04-15"           // optional: default is yesterday
}
```

Response: `SheetExportRun` object

### Manual Sheets Range (Multi-Day)

**Endpoint:** `POST /api/v1/sheets/manual-range-runs`

Same parameters as manual, but with:
- `dateFrom` and `dateTo` instead of `runDate`
- Backend spawns one daily export job per day in the range
- Frontend can poll progress: `GET /api/v1/sheets/manual-range-runs/:runId`

### Scheduled Sheets Export (Daily)

If an `AccountSheetConfig` is `active=true`:

1. Scheduler tick runs each day at configured time (default 01:10 Kyiv)
2. Fetches that account's latest daily facts (filtered by `campaignStatusesCsv`,
   then `campaignNameExcludeCsv` removes campaigns whose names contain any of
   the listed substrings — case-insensitive)
3. Writes to the configured Sheets spreadsheet/tab
4. Mode: UPSERT (dedup by row key)

**Multi-config per account:** An account may have multiple active configs that
write to different `(spreadsheetId, sheetName)` destinations — e.g. one with
`dataMode=DAILY_TOTAL` for a "daily summary" tab and one with
`dataMode=CAMPAIGN` for a "by-campaign" tab. The "+ New config" UI flow sends
`createNew: true` so a fresh config is created instead of overwriting the
existing one. At the DB level, a partial unique index on
`(adsAccountId, spreadsheetId, sheetName) WHERE active=true` prevents
race-condition duplicates from concurrent upserts.

### Automatic Catch-Up After Token Expiry (Backfill)

When the Google token expires, everything stops and a gap grows. Recovery is
now a single human action:

1. `GET /healthz/alert` returns `503` (`oauth:NEEDS_REAUTH`) → uptime monitor
   notifies the operator
2. Operator re-logs in via «Увійти через Google»
3. The OAuth callback detects recovery from `NEEDS_REAUTH` and requests a
   backfill pass automatically (`trigger=REAUTH`)
4. Worker fills the DB gap day-by-day (skipping already-complete days), then
   exports the same days to every active sheet config
5. `/healthz/alert` returns to `200`; progress is visible on the Планувальник
   page («Довантаження даних» card) and via `GET /scheduler/backfill`

See "Token-expiry backfill" in Core Concepts for mechanics and guarantees.

---

## Data Freshness

### Coverage Endpoint

**GET** `/api/v1/ingestion/coverage`

Returns per-account freshness info:

```json
{
  "accounts": [
    {
      "accountId": "123456789",
      "descriptiveName": "My Ads Account",
      "lastFactDate": "2026-04-15",
      "hasDataForYesterday": true,
      "staleDays": 1
    }
  ]
}
```

Used by frontend **"Дані до"** (Data Until) column on Accounts page to show which accounts are current.

---

## Security & Authentication

### OAuth 2.0 Flow

1. User clicks "Увійти через Google"
2. Frontend redirects to `GET /api/v1/auth/login/start`
3. Backend generates OAuth state, stores in DB, returns `authUrl`
4. User logs in with Google
5. Redirects to `GET /api/v1/google/oauth/callback?code=...&state=...`
6. Backend exchanges code for tokens
7. Validates user email against `APP_ALLOWED_GOOGLE_EMAILS`
8. Creates session cookie `ads_mvp_session` (signed with `APP_SESSION_SECRET`)
9. Refresh token encrypted with `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` and stored in DB

### Session & Rate Limiting

- **Session TTL:** `APP_SESSION_TTL_DAYS` (default 6 days), then forced re-login
- **Rate Limits:**
  - Login endpoint: `RATE_LIMIT_AUTH_LOGIN_START_MAX` attempts per `RATE_LIMIT_AUTH_LOGIN_START_WINDOW_MS`
  - Write endpoints (POST/PUT/DELETE): `RATE_LIMIT_WRITE_MAX` per `RATE_LIMIT_WRITE_WINDOW_MS`
  - Rate limit key: by email (if session valid) or IP (fallback)

### Environment Secrets (Production)

**Required in production:**
- `APP_ALLOWED_GOOGLE_EMAILS` — Comma-separated list
- `APP_SESSION_SECRET` — Long random string for session signing
- `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` — Long random string for token encryption

Never commit `.env` files with secrets. Use deployment secrets management.

---

## Concurrency & Race Conditions

### Ingestion Locking

Ingestion runs use PostgreSQL advisory locks to prevent concurrent execution:

```sql
SELECT pg_advisory_lock(10401001);
-- Check if another run is in progress
-- If not, create new IngestionRun
SELECT pg_advisory_unlock(10401001);
```

### Upsert Deduplication (Sheets)

When exporting to Sheets with UPSERT mode:

1. Compute row key: `hash(date + customer_id + campaign_id)`
2. Check `SheetRowState` for that key in that config
3. If row already exported with same hash, skip (no change)
4. If hash differs, update the row in Sheets

---

## Error Handling

### Stale Run Auto-Fail

If an ingestion or Sheets run doesn't progress for too long:

- **Ingestion:** `INGESTION_RUN_STALE_MINUTES` (default 180 min = 3 hours)
- **Sheets:** `SHEETS_RUN_STALE_MINUTES` (default 240 min = 4 hours)

Scheduler checks `updatedAt` (heartbeat) not just `startedAt`. Stale runs marked as FAILED automatically.

### Google Ads Quota

Exponential backoff with quota-aware retry delay:

```typescript
if (quota_exceeded) {
  const retryAfterSeconds = extractGoogleAdsRetryAfterSeconds(error);
  await delay(retryAfterSeconds * 1000 * exponentialFactor);
  retry();
}
```

Configured via `GOOGLE_ADS_RETRY_ATTEMPTS` and `GOOGLE_ADS_RETRY_BASE_DELAY_MS`.

### Google Sheets Quota

Similar pattern for Sheets:

- Detects `ReadRequestsPerMinutePerUser` quota
- Backs off with `resolveGoogleSheetsQuotaRetryDelayMs()`
- Skips unnecessary read requests during export

---

## Deployment

### Local Development

```bash
npm install && npm run web:install
docker compose up -d
cp .env.example .env
# Fill in Google OAuth & Ads credentials
npm run db:generate && npm run db:migrate:deploy
npm run web:build
npm run dev
```

Visit `http://localhost:4010`

### Production (Docker + Traefik)

```bash
cp .env.deploy.example .env.deploy
# Edit .env.deploy with production values
docker compose -f docker-compose.deploy.yml up -d --build
```

- **Container:** Single `app` service (backend + frontend)
- **Database:** Separate `db` container
- **Reverse Proxy:** Traefik (auto-HTTPS for `adsmvp.workflo.space`)
- **Timezone:** `Europe/Kyiv` in all containers

---

## Health & Monitoring

### Health Check Endpoints

- **`GET /healthz`** — Checks API + DB connection
- **`GET /api/v1/ingestion/health`** — Ingestion run history summary
- **`GET /api/v1/sheets/health`** — Sheets export run history summary
- **`GET /api/v1/scheduler/health`** — Scheduler tick status

### Logging

- **Log Level:** `debug` in development, `info` in production
- **Format:** JSON (Pino)
- **Redaction:** Cookies, authorization headers, refresh tokens redacted from logs

---

## Project Structure

```
ads_mvp_report/
├── src/
│   ├── main.ts                 # Express app bootstrap
│   ├── config/
│   │   └── env.ts              # Zod schema for .env vars
│   ├── lib/
│   │   ├── http.ts             # ApiError, asyncHandler
│   │   ├── prisma.ts           # Prisma client singleton
│   │   ├── timezone.ts         # Date helpers (UTC/Kyiv)
│   │   ├── google-ads-quota.ts # Retry backoff for Ads API
│   │   ├── google-sheets-quota.ts # Retry backoff for Sheets API
│   │   └── rate-limit.ts       # Express rate limiter
│   └── modules/
│       ├── auth/               # Google OAuth, session
│       ├── google/             # Account sync, credentials
│       ├── campaigns/          # Campaign discovery & sync
│       ├── ingestion/          # Ads API → DB (main logic)
│       ├── sheets/             # DB → Sheets (main logic)
│       └── scheduler/          # Tick-based orchestration
├── web/
│   ├── src/
│   │   ├── api/                # HTTP clients (auth, ingestion, etc.)
│   │   ├── pages/              # Page components (6 pages)
│   │   ├── components/         # Reusable UI (RunningBanner, etc.)
│   │   ├── hooks/              # usePolling
│   │   └── App.tsx             # Root + routing
│   └── package.json
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── migrations/             # Migration history
├── tests/
│   └── *.test.ts               # Test files
├── docs/
│   └── OVERVIEW.md             # This file
├── docker-compose.yml          # Local dev DB
├── docker-compose.deploy.yml   # Production deployment
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Next Steps / Roadmap

- **Testing:** Run `npm run test` to execute test suite
- **Type Safety:** `npm run typecheck` to verify TypeScript
- **Linting:** `npm run lint` combines typecheck + tests
- **Full Build:** `npm run check` = lint + test + build
- **Database Migrations:** `npm run db:migrate:deploy` applies pending migrations

---

## Support & Troubleshooting

**Common Issues:**

1. **"Database schema is missing tables"** → Run `npm run db:migrate:deploy`
2. **"Invalid production configuration"** → Check `.env` for required secrets
3. **"OAuth token needs refresh"** → User must re-login (token expired)
4. **"Scheduler not running"** → Check logs: `docker logs app` or console
5. **"Google Sheets quota exceeded"** → Wait ~1 min; scheduler retries with backoff
6. **"Scheduler keeps re-running yesterday over and over"** → A known ICU bug
   in Node 20 + ICU 78 returns `hour=24` at local midnight. The fix is in
   `src/lib/timezone.ts` (`rawHour === 24 ? 0 : rawHour`). If you ever see
   thousands of identical SCHEDULER runs in 24h for the same `runDate`,
   verify this normalization is still in place.
7. **"Sheets auto-export stops advancing past a single runDate"** → Likely
   an orphan config (account left MCC). Check
   `SELECT id, "sheetName", a."isInMcc" FROM "AccountSheetConfig" c JOIN "AdsAccount" a ON a.id=c."adsAccountId" WHERE c.active=true AND a."isInMcc"=false`.
   Since 2026-05-27, the scheduler auto-deactivates such configs after one
   failed attempt — but a manual `UPDATE AccountSheetConfig SET active=false WHERE id='...'`
   is the immediate remedy.

**Logs:**

- **Local:** `npm run dev` prints to console
- **Docker:** `docker logs -f app`
- **Deployment:** `docker compose -f docker-compose.deploy.yml logs -f app`

---

**For detailed API documentation, see [FEATURES.md](./FEATURES.md)**  
**For environment variables, see [CONFIGURATION.md](./CONFIGURATION.md)**  
**For testing notes, see [TESTING.md](./TESTING.md)**
