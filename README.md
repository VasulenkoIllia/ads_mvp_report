# Ads MVP Report

**A minimal Google Ads reporting dashboard** — automatically pulls data from Google Ads API into PostgreSQL, then exports to Google Sheets (manually or on schedule).

**Core Features:**
- Google OAuth login with email allowlist
- Auto-sync Google Ads MCC accounts
- Manual/scheduled ingestion to PostgreSQL (with rolling refresh for late conversions)
- Manual/scheduled export to Google Sheets (UPSERT mode prevents duplicates)
- Real-time progress tracking for ingestion & export runs
- Support for new conversion value & ROAS metrics

## Quick Start (5 minutes)

### 1. Prerequisites
- Node.js 20+, npm
- Docker (for PostgreSQL)
- Google Cloud OAuth credentials
- Google Ads Manager Account ID & Developer Token

### 2. Install & Setup

```bash
git clone <repo>
cd ads_mvp_report
npm install && npm run web:install
docker compose up -d              # Start PostgreSQL
cp .env.example .env              # Copy config template
# Edit .env: add Google OAuth, Ads API credentials
npm run db:generate
npm run db:migrate:deploy
npm run web:build
npm run dev
```

Visit: `http://localhost:4010` — Login with allowed Google account

### 3. First Steps

1. **Sync accounts** — Click "Акаунти" → "Синхронізувати" button
2. **Run ingestion** — Click "Дані" → Select date → "Запустити завантаження"
3. **Export to Sheets** — Click "Google Sheets" → Create config or manual export
4. **Enable scheduler** — Click "Планувальник" to configure daily runs

---

## Architecture

- **Backend:** Node.js + Express + Prisma + PostgreSQL
- **Frontend:** React + Ant Design (bundled in `web/dist`, served from backend)
- **Scheduler:** Internal tick-based scheduler with `Europe/Kyiv` timezone
- **Security:** Google OAuth 2.0 with refresh token encryption
- **Database:** PostgreSQL required for production; SQLite for local dev

## Key Concepts

### Data Flow

```
Google Ads API (daily metrics)
        ↓
    [Ingestion Job] 
        ↓
PostgreSQL (CampaignDailyFact table)
        ↓
  [Sheets Export Job]
        ↓
Google Sheets (user's spreadsheet)
```

### Accounts & Permissions

- **MCC (Master Customer Account):** Your manager account ID (provided to system)
- **Child Accounts:** Auto-discovered from MCC; synced with status ENABLED only
- **Ingestion Control:** Enable/disable ingestion per account via UI
- **Sheets Config:** Configure automatic exports at account level

### Run History

- **IngestionRun:** Tracks pulling data from Ads API (date range, account count, status)
- **SheetExportRun:** Tracks pushing data to Sheets (config, row count, status)
- **Manual Ranges:** Multi-day exports tracked separately with daily progress

### Data Freshness

- **Coverage Endpoint:** Shows last data date per account
- **Scheduler:** Daily checks last 3 days (catchup) + last 2 days (refresh for late conversions)
- **No Data Blocking:** Sheets export waits for fresh ingestion data but doesn't block scheduler

---

## Security

- **Authentication:** Google OAuth 2.0 only; email whitelist in `APP_ALLOWED_GOOGLE_EMAILS`
- **Session:** HTTP-only cookie `ads_mvp_session` (signed with `APP_SESSION_SECRET`)
- **Token Encryption:** Refresh tokens encrypted in DB with `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`
- **Rate Limiting:** Login + write endpoints rate-limited by IP/email
- **CORS:** Configurable origin whitelist
- **Production Requirements:**
  - `APP_ALLOWED_GOOGLE_EMAILS` — Set to your users
  - `APP_SESSION_SECRET` — Long random string
  - `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` — Long random string

## UI Pages

- **Огляд (Overview):** Status cards, recent runs, data freshness alerts
- **Акаунти (Accounts):** Account list, sync status, data freshness ("Дані до" column)
- **Кампанії (Campaigns):** Browse campaigns by account/status, campaign-level search
- **Дані (Ingestion):** Manual ingestion form, live progress, per-account progress panel
- **Google Sheets:** Config management (auto-export per account), manual export form, campaign name filter, range exports
- **Планувальник (Scheduler):** Edit schedule time, catchup/refresh windows, retry settings

### UI Features

- **Lazy Loading:** All pages code-split with React.lazy + Suspense
- **Live Progress:** RunningBanner shows active ingestion/sheets runs with real-time progress
- **Adaptive Polling:** Polling fast (3s) when active, slow (30s) when idle
- **Language:** Ukrainian (Ant Design `uk_UA` locale)

## New Features

### Conversion Value & ROAS Metrics

Both metrics automatically ingested from Google Ads API and exported to Sheets:

- **Conversion Value** — Total value of all conversions (`metrics.conversions_value` in GAQL)
  - Stored in DB as `CampaignDailyFact.conversionValue`
  - Exported to Sheets as column `conversion_value`
- **ROAS (Return on Ad Spend)** — Conversion value ÷ cost
  - Computed during ingestion
  - Stored in DB as `CampaignDailyFact.conversionValuePerCost`
  - Exported to Sheets as column `conversion_value_per_cost`

**Example:** ROAS 13.23 = 13.23₴ return per 1₴ spent

### Campaign Name Filter

Manual exports support filtering campaigns by name (case-insensitive substring match):

```
campaignNameSearch: "pmax"  // Matches "My PMAX Campaign", "pMax Ads", etc.
```

Available in:
- `POST /sheets/runs/manual` — Single-date manual export
- `POST /sheets/manual-range-runs` — Multi-day range export
- `GET /sheets/preview` — Preview before export

### Scheduler Enhancements

- **Configurable Initial Delay** — `SCHEDULER_INITIAL_DELAY_SECONDS` prevents accidental runs on dev hot-reload
- **Catchup Window** — Configurable days back to check (default 3 = check -3, -2, -1)
- **Refresh Window** — Configurable recent days to re-process (default 2 = catch late conversions)
- **Per-Account Disable** — Ingestion can be disabled per account without disabling system-wide scheduler

## Reliability & Concurrency

- **Date Validation:** Strict `YYYY-MM-DD` format; invalid dates rejected
- **Ingestion Locking:** PostgreSQL advisory lock prevents concurrent runs
- **Stale Run Detection:** Auto-fail runs that don't progress for `INGESTION_RUN_STALE_MINUTES` (heartbeat-based, not just timeout)
- **Upsert Deduplication:** Sheets row hashing prevents duplicate rows on re-export
- **Quota-Aware Retries:** Exponential backoff with quota-specific delays for Google Ads & Sheets APIs
- **Pipeline Independence:** Ingestion failure doesn't block Sheets export; scheduler runs both independently each tick

## Detailed Setup Guide

### Prerequisites

```bash
# Check Node.js version
node --version  # v20+

# Install Docker (for PostgreSQL)
docker --version  # Install from https://www.docker.com
```

### Step 1: Clone & Install

```bash
git clone <repo>
cd ads_mvp_report
npm install
npm run web:install
```

### Step 2: Database Setup

```bash
docker compose up -d
# Verify PostgreSQL running: docker compose ps
```

### Step 3: Configuration

```bash
cp .env.example .env
# Edit .env with your values:
# - APP_ALLOWED_GOOGLE_EMAILS (your email)
# - GOOGLE_OAUTH_CLIENT_ID (from Google Cloud Console)
# - GOOGLE_OAUTH_CLIENT_SECRET (from Google Cloud Console)
# - GOOGLE_OAUTH_REDIRECT_URI (http://localhost:4010/api/v1/google/oauth/callback)
# - GOOGLE_ADS_DEVELOPER_TOKEN (from Google Ads account)
# - GOOGLE_ADS_MANAGER_CUSTOMER_ID (your MCC customer ID)
```

### Step 4: Database Migration

```bash
npm run db:generate
npm run db:migrate:deploy

# If P3005 error (baseline needed):
# npx prisma migrate resolve --applied 20260311_init
# npm run db:migrate:deploy
```

### Step 5: Start

```bash
npm run web:build
npm run dev
```

Open `http://localhost:4010` in browser.

### Step 6 (Optional): Live Frontend Development

In another terminal:
```bash
npm run web:dev
```

Frontend runs on `http://localhost:5173` with live reload. Backend API still at 4010.

## Production Deployment

### Option 1: Docker Compose with Traefik

Two compose files included:

- **`docker-compose.yml`** — Local dev (SQLite/PostgreSQL)
- **`docker-compose.deploy.yml`** — Production (PostgreSQL + Traefik)

### Deploy Steps

1. **Prepare production config:**

```bash
cp .env.deploy.example .env.deploy
```

2. **Edit `.env.deploy`:**

```bash
# Domain & SSL
DEPLOY_CORS_ORIGIN=https://adsmvp.workflo.space
GOOGLE_OAUTH_REDIRECT_URI=https://adsmvp.workflo.space/api/v1/google/oauth/callback

# Required secrets
APP_ALLOWED_GOOGLE_EMAILS=user@example.com
APP_SESSION_SECRET=<generate with: openssl rand -hex 32>
GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY=<generate with: openssl rand -hex 32>

# Credentials
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_MANAGER_CUSTOMER_ID=...

# Database
POSTGRES_PASSWORD=<strong-password>

# Optional tuning
SCHEDULER_CATCHUP_DAYS=3
SCHEDULER_REFRESH_DAYS=2
RATE_LIMIT_WRITE_MAX=30
```

3. **Deploy:**

```bash
docker compose -f docker-compose.deploy.yml up -d --build
docker compose -f docker-compose.deploy.yml logs -f app
```

### Option 2: Manual Deployment

For non-Docker environments:

1. Install Node.js 20+
2. Install PostgreSQL 12+
3. Clone repo, `npm install && npm run web:install`
4. Set `.env` variables (same as above)
5. `npm run db:generate && npm run db:migrate:deploy`
6. `npm run web:build && npm run build`
7. `npm start` (runs compiled JS from `dist/main.js`)
8. Use reverse proxy (nginx/Apache) for HTTPS & domain

## Pre-Deployment Checklist

Before going live:

- [ ] Run `npm run check` (lint + test + build succeeds)
- [ ] Verify all required secrets set in `.env` (no defaults like `change_me_...`)
- [ ] Test OAuth flow locally (login + callback works)
- [ ] Test ingestion run locally (can pull Ads data)
- [ ] Test Sheets export locally (can write to test spreadsheet)
- [ ] Google Ads MCC account has ENABLED child accounts (disabled ones are skipped)
- [ ] Google Cloud OAuth app has correct redirect URI registered
- [ ] PostgreSQL database is running and accessible
- [ ] Database migrations applied: `npm run db:migrate:deploy`
- [ ] Build succeeds: `npm run build`

## API Quick Reference

All endpoints require authentication (except login endpoints) and are prefixed with `/api/v1/`.

### Core Endpoints

**Authentication:**
- `GET /auth/session` — Get current user
- `GET /auth/login/start` — Start Google OAuth
- `POST /auth/logout` — End session

**Accounts:**
- `POST /google/accounts/sync` — Sync MCC child accounts
- `GET /google/accounts` — List accounts
- `GET /ingestion/coverage` — Data freshness per account

**Ingestion (pull Ads → DB):**
- `POST /ingestion/runs` — Start manual ingestion
- `GET /ingestion/runs/active` — Get current run (for progress tracking)
- `GET /ingestion/runs` — List run history
- `GET /ingestion/preflight` — Validate request without executing

**Sheets Export (push DB → Sheets):**
- `GET /sheets/configs` — List export configs
- `PUT /sheets/configs/:accountId` — Create/update auto-export config
- `POST /sheets/runs/manual` — Single-date export
- `POST /sheets/manual-range-runs` — Multi-day export (background job)
- `GET /sheets/preview` — Preview rows before export

**Scheduler:**
- `GET /scheduler/settings` — Current schedule
- `PATCH /scheduler/settings` — Update schedule

**Health:**
- `GET /healthz` — API + database check

See [FEATURES.md](./docs/FEATURES.md) for complete API documentation with parameters & examples.

---

## Documentation

- **[OVERVIEW.md](./docs/OVERVIEW.md)** — Architecture, data flow, core concepts
- **[FEATURES.md](./docs/FEATURES.md)** — Complete API reference with examples
- **[CONFIGURATION.md](./docs/CONFIGURATION.md)** — All environment variables explained
- **[TESTING.md](./docs/TESTING.md)** — Test results, known data, debugging
