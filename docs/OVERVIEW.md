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
│   (Local DB)    │ │ API (v18)    │ │ Spreadsheets API │
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
    │ - Mode: APPEND, UPSERT   │
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
   - Links to `AccountSheetConfig` (the destination)

Both track: start/end times, row counts, error summaries.

### Scheduler

Internal tick-based scheduler (not cron):

- **Poll Interval:** `SCHEDULER_POLL_SECONDS` (default 30s)
- **Timezone:** `Europe/Kyiv` (configurable)
- **Logic:** Each tick checks if it's time to run ingestion or sheets based on scheduled hour/minute
- **Catchup:** By default checks `-3, -2, -1` days relative to today (`SCHEDULER_CATCHUP_DAYS`)
- **Refresh:** Also checks latest `SCHEDULER_REFRESH_DAYS` days each run (for late-arriving conversions)
- **Rate Limiting:** `ingestionMaxDailyAttempts`, `sheetsMaxDailyAttempts` prevent runaway retries

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
  "campaignNameSearch": "pmax",     // optional: case-insensitive contains
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

1. Scheduler tick runs each day at configured time
2. Fetches that account's latest daily facts
3. Writes to the configured Sheets spreadsheet/tab
4. Mode: UPSERT (dedup by row key)

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

**Logs:**

- **Local:** `npm run dev` prints to console
- **Docker:** `docker logs -f app`
- **Deployment:** `docker compose -f docker-compose.deploy.yml logs -f app`

---

**For detailed API documentation, see [FEATURES.md](./FEATURES.md)**  
**For environment variables, see [CONFIGURATION.md](./CONFIGURATION.md)**  
**For testing notes, see [TESTING.md](./TESTING.md)**
