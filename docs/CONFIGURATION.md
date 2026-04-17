# Ads MVP Report — Configuration & Environment Variables

**Last Updated:** 2026-04-17

All configuration is managed via environment variables (`.env` file). Use Zod schemas for validation.

---

## Setup

### Local Development

```bash
cp .env.example .env
# Edit .env with your values
npm install
npm run db:generate
npm run db:migrate:deploy
npm run web:build
npm run dev
```

### Production Deployment

```bash
cp .env.deploy.example .env.deploy
# Edit .env.deploy with production values
docker compose -f docker-compose.deploy.yml up -d --build
```

---

## Core Environment Variables

### Application Runtime

#### NODE_ENV
- **Type:** `development` | `test` | `production`
- **Default:** `development`
- **Description:** Runtime environment mode. Affects logging level (debug vs info) and required secrets.

#### PORT
- **Type:** Integer
- **Default:** `4010`
- **Range:** 1–65535
- **Description:** HTTP server port. In production with Traefik, typically 80/443.

#### CORS_ORIGIN
- **Type:** Comma-separated URLs
- **Default:** `http://localhost:4010,http://localhost:5173`
- **Example:** `http://localhost:4010,http://localhost:5173,https://adsmvp.workflo.space`
- **Description:** Allowed origins for CORS requests. Frontend must be in this list.

#### DASHBOARD_ENABLED
- **Type:** Boolean
- **Default:** `true`
- **Values:** `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off` (case-insensitive)
- **Description:** Enable built-in React dashboard on `/`. If false, only API endpoints available.

---

## Database

#### DATABASE_URL
- **Type:** PostgreSQL connection string
- **Default:** `file:./prisma/dev.db` (SQLite for local dev only)
- **Format:** `postgresql://user:password@host:port/dbname?schema=public`
- **Example:** `postgresql://ads_mvp_report:password@localhost:5434/ads_mvp_report?schema=public`
- **Required:** Yes
- **Note:** PostgreSQL required for production (SQLite for local dev only)

#### POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
- **Type:** String
- **Used by:** `docker-compose.deploy.yml` to create database
- **Description:** Database credentials for Docker deployment. Match `DATABASE_URL` credentials.

#### PRISMA_MIGRATE_ON_START
- **Type:** Boolean
- **Default:** `true`
- **Description:** Automatically run `prisma migrate deploy` on app startup. Set to `false` if managing migrations manually.

---

## Authentication & Security

### Session Management

#### APP_ALLOWED_GOOGLE_EMAILS
- **Type:** Comma-separated email list
- **Default:** `owner@workflo.space`
- **Required in production:** Yes
- **Example:** `user1@example.com,user2@example.com,owner@workflo.space`
- **Description:** Whitelist of Google accounts allowed to login. Only users with these emails can access the system.

#### APP_SESSION_SECRET
- **Type:** Long random string (min 32 chars recommended)
- **Required in production:** Yes
- **Default:** `change_me_to_long_random_secret`
- **Description:** Used to sign session cookies. Must be kept secret in production. Never commit real value.
- **Generate:** `openssl rand -hex 32`

#### APP_SESSION_TTL_DAYS
- **Type:** Integer
- **Default:** `6`
- **Range:** 1–30
- **Description:** Session lifetime in days. Users must re-login after this period.

### Google OAuth 2.0

#### GOOGLE_OAUTH_CLIENT_ID
- **Type:** String (OAuth client ID from Google Cloud Console)
- **Required:** Yes (for OAuth to work)
- **Format:** `xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`
- **Description:** OAuth 2.0 Client ID from Google Cloud project.
- **Setup:** https://console.cloud.google.com/apis/credentials

#### GOOGLE_OAUTH_CLIENT_SECRET
- **Type:** String (OAuth client secret from Google Cloud Console)
- **Required:** Yes (for OAuth to work)
- **Description:** OAuth 2.0 Client Secret. Keep secret; never commit.

#### GOOGLE_OAUTH_REDIRECT_URI
- **Type:** URL
- **Default:** `http://localhost:4010/api/v1/google/oauth/callback`
- **Production example:** `https://adsmvp.workflo.space/api/v1/google/oauth/callback`
- **Required:** Yes
- **Description:** OAuth callback URL. Must match exactly in Google Cloud Console OAuth app settings.

#### GOOGLE_OAUTH_SCOPES
- **Type:** Space-separated scope URIs
- **Default:** `https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email openid`
- **Description:** OAuth 2.0 scopes requested. Default includes: Google Ads API, Google Sheets, user info.

#### GOOGLE_OAUTH_STATE_TTL_MINUTES
- **Type:** Integer
- **Default:** `15`
- **Range:** 1–max integer
- **Description:** Validity period of OAuth state tokens (prevents CSRF). Increase if users are slow to click login link.

#### GOOGLE_OAUTH_TOKEN_ALERT_DAYS
- **Type:** Integer
- **Default:** `7`
- **Range:** 0–max integer
- **Description:** Show warning in UI if refresh token expires within this many days.

#### GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY
- **Type:** Long random string (min 32 chars recommended)
- **Required in production:** Yes
- **Default:** `change_me_to_long_random_secret`
- **Description:** Encryption key for storing encrypted refresh tokens in DB. Must be kept secret and consistent.
- **Generate:** `openssl rand -hex 32`
- **Warning:** Changing this key will invalidate all stored refresh tokens; users must re-login.

---

## Rate Limiting

#### RATE_LIMIT_AUTH_LOGIN_START_WINDOW_MS
- **Type:** Integer (milliseconds)
- **Default:** `60000` (1 minute)
- **Range:** 1000–3600000
- **Description:** Time window for login rate limit.

#### RATE_LIMIT_AUTH_LOGIN_START_MAX
- **Type:** Integer
- **Default:** `20`
- **Range:** 1–500
- **Description:** Max login attempts per window per IP address.

#### RATE_LIMIT_WRITE_WINDOW_MS
- **Type:** Integer (milliseconds)
- **Default:** `60000` (1 minute)
- **Range:** 1000–3600000
- **Description:** Time window for write (POST/PUT/PATCH/DELETE) rate limit.

#### RATE_LIMIT_WRITE_MAX
- **Type:** Integer
- **Default:** `30`
- **Range:** 1–1000
- **Description:** Max write requests per window per user (or IP if not authenticated).

---

## Google Ads API Configuration

#### GOOGLE_ADS_DEVELOPER_TOKEN
- **Type:** String
- **Required:** Yes
- **Format:** Usually 10-12 alphanumeric characters
- **Description:** Developer token for Google Ads API. Obtain from Google Ads Manager account settings.
- **Setup:** https://ads.google.com/aw/apicenter

#### GOOGLE_ADS_MANAGER_CUSTOMER_ID
- **Type:** String (numeric, can have hyphens)
- **Required:** Yes
- **Format:** `1234567890` or `123-456-7890`
- **Description:** Your Google Ads Manager (MCC) customer ID. This is the parent account ID under which all child accounts are managed.

#### GOOGLE_ADS_API_VERSION
- **Type:** String
- **Default:** `v18`
- **Description:** Google Ads API version to use. Check Google documentation for latest stable version.
- **Note:** Currently targets v18; update if Google releases new versions.

#### GOOGLE_ADS_HTTP_TIMEOUT_MS
- **Type:** Integer (milliseconds)
- **Default:** `30000` (30 seconds)
- **Range:** Must be positive
- **Description:** HTTP request timeout for Google Ads API calls. Increase if you have many campaigns/accounts.

#### GOOGLE_ADS_RETRY_ATTEMPTS
- **Type:** Integer
- **Default:** `4`
- **Range:** 1–10
- **Description:** Max retry attempts for failed Google Ads API requests (exponential backoff).

#### GOOGLE_ADS_RETRY_BASE_DELAY_MS
- **Type:** Integer (milliseconds)
- **Default:** `400`
- **Range:** Must be positive
- **Description:** Base delay for exponential backoff: delay = baseDelay * (2 ^ attempt).

---

## Google Sheets API Configuration

#### GOOGLE_SHEETS_REQUIRED_SCOPE
- **Type:** URL
- **Default:** `https://www.googleapis.com/auth/spreadsheets`
- **Description:** Required OAuth scope for Sheets API. Must be included in `GOOGLE_OAUTH_SCOPES`.

#### GOOGLE_SHEETS_HTTP_TIMEOUT_MS
- **Type:** Integer (milliseconds)
- **Default:** `30000` (30 seconds)
- **Range:** Must be positive
- **Description:** HTTP request timeout for Google Sheets API calls.

#### GOOGLE_SHEETS_RETRY_ATTEMPTS
- **Type:** Integer
- **Default:** `4`
- **Range:** 1–10
- **Description:** Max retry attempts for failed Sheets API requests.

#### GOOGLE_SHEETS_RETRY_BASE_DELAY_MS
- **Type:** Integer (milliseconds)
- **Default:** `400`
- **Range:** Must be positive
- **Description:** Base delay for exponential backoff.

---

## Data Ingestion Configuration

#### INGESTION_MAX_RANGE_DAYS
- **Type:** Integer
- **Default:** `365`
- **Range:** 1–730
- **Description:** Maximum allowed date range for manual ingestion requests. Prevents excessively large requests.

#### INGESTION_RUN_STALE_MINUTES
- **Type:** Integer
- **Default:** `180` (3 hours)
- **Range:** 5–1440
- **Description:** Ingestion runs that don't update for this long are auto-marked as FAILED. Prevents hung runs from blocking scheduler.

---

## Sheets Export Configuration

#### SHEETS_MANUAL_MAX_RANGE_DAYS
- **Type:** Integer
- **Default:** `180` (6 months)
- **Range:** 1–730
- **Description:** Maximum allowed date range for manual Sheets exports. Prevents excessively large exports.

#### SHEETS_RUN_STALE_MINUTES
- **Type:** Integer
- **Default:** `240` (4 hours)
- **Range:** 5–1440
- **Description:** Sheets export runs that don't update for this long are auto-marked as FAILED.

---

## Scheduler Configuration

#### SCHEDULER_POLL_SECONDS
- **Type:** Integer
- **Default:** `30`
- **Range:** 10–300
- **Description:** How often scheduler checks if it's time to run ingestion/sheets (in seconds). Lower = more responsive but uses more CPU.

#### SCHEDULER_CATCHUP_DAYS
- **Type:** Integer
- **Default:** `3`
- **Range:** 1–14
- **Description:** How many past days the scheduler checks on each run. For example, with value 3, checks -3, -2, -1 days relative to today to catch missed runs.
- **Example:** Today is 2026-04-17, catchup_days=3 → checks 04-14, 04-15, 04-16

#### SCHEDULER_REFRESH_DAYS
- **Type:** Integer
- **Default:** `2`
- **Range:** 0–14
- **Description:** How many recent days the scheduler re-processes on each run to pick up late-arriving conversion data. Value 0 disables refresh.
- **Example:** Conversions can arrive 1-2 days late; refresh_days=2 ensures we re-check yesterday and today.

#### SCHEDULER_INITIAL_DELAY_SECONDS
- **Type:** Integer
- **Default:** `0`
- **Range:** 0–3600
- **Description:** Delay before first scheduler tick on app startup. Useful in development to prevent hot-reload triggering ingestion immediately.
- **Recommended for dev:** `10` or `20`
- **Recommended for prod:** `0`

---

## Schedule Timing (Scheduler Settings)

These are stored in DB (SchedulerSettings table) but have defaults:

### Ingestion Schedule

- **ingestionEnabled** — Boolean; enable/disable automatic daily ingestion
- **ingestionHour** — Hour of day (0–23) in `Europe/Kyiv` timezone (default 1 = 01:00 AM)
- **ingestionMinute** — Minute of hour (0–59) (default 0 = :00 AM)
- **ingestionMaxDailyAttempts** — Max retries per day if ingestion fails (default 2)
- **ingestionRetryDelayMin** — Minutes to wait before retrying failed ingestion (default 20)
- **ingestionBatchSize** — Accounts processed per API batch (default 100)
- **ingestionMaxAccounts** — Max accounts to process per run (default 5000)

### Sheets Schedule

- **sheetsEnabled** — Boolean; enable/disable automatic daily Sheets exports
- **sheetsHour** — Hour of day (0–23) in `Europe/Kyiv` timezone (default 1 = 01:00 AM)
- **sheetsMinute** — Minute of hour (0–59) (default 10 = :10 AM)
- **sheetsMaxDailyAttempts** — Max retries per day if export fails (default 2)
- **sheetsRetryDelayMin** — Minutes to wait before retrying failed export (default 20)
- **sheetsMaxConfigsPerTick** — Max configs to process per scheduler tick (default 200)

### Timezone

- **timezone** — IANA timezone (default `Europe/Kyiv`). Used to interpret scheduled hours.

---

## Production Checklist

Before deploying to production, verify:

1. **Security Variables:**
   - [ ] `APP_ALLOWED_GOOGLE_EMAILS` — Set to your user(s)
   - [ ] `APP_SESSION_SECRET` — Long random string, different from example
   - [ ] `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` — Long random string, different from example

2. **OAuth Variables:**
   - [ ] `GOOGLE_OAUTH_CLIENT_ID` — Obtained from Google Cloud Console
   - [ ] `GOOGLE_OAUTH_CLIENT_SECRET` — Obtained from Google Cloud Console
   - [ ] `GOOGLE_OAUTH_REDIRECT_URI` — Matches your production domain (e.g., `https://adsmvp.workflo.space/api/v1/google/oauth/callback`)

3. **Google Ads Variables:**
   - [ ] `GOOGLE_ADS_DEVELOPER_TOKEN` — Obtained from Ads account
   - [ ] `GOOGLE_ADS_MANAGER_CUSTOMER_ID` — Your MCC account ID

4. **Database:**
   - [ ] `DATABASE_URL` — Production PostgreSQL (not SQLite)
   - [ ] Database is running and accessible
   - [ ] Migrations are applied: `npm run db:migrate:deploy`

5. **CORS & Networking:**
   - [ ] `CORS_ORIGIN` — Includes your production domain
   - [ ] `PORT` — Correct for your infrastructure (usually 80/443 behind Traefik)

6. **Scheduler:**
   - [ ] `SCHEDULER_INITIAL_DELAY_SECONDS` — Set to `0` in production
   - [ ] `SCHEDULER_POLL_SECONDS` — Reasonable value (30 is good default)
   - [ ] `SCHEDULER_CATCHUP_DAYS` — Set to desired catchup window (3 is common)
   - [ ] `SCHEDULER_REFRESH_DAYS` — Set to desired refresh window (2 is common)

7. **Testing:**
   - [ ] Run `npm run check` (lint + test + build)
   - [ ] Manually test OAuth login flow
   - [ ] Manually test ingestion run
   - [ ] Manually test Sheets export

---

## Example .env Files

### Local Development

```bash
NODE_ENV=development
PORT=4010
CORS_ORIGIN=http://localhost:4010,http://localhost:5173
DATABASE_URL=postgresql://ads_mvp_report:ads_mvp_report@localhost:5434/ads_mvp_report?schema=public
DASHBOARD_ENABLED=true

APP_ALLOWED_GOOGLE_EMAILS=you@example.com
APP_SESSION_SECRET=dev-secret-change-in-prod
APP_SESSION_TTL_DAYS=6
RATE_LIMIT_AUTH_LOGIN_START_WINDOW_MS=60000
RATE_LIMIT_AUTH_LOGIN_START_MAX=20
RATE_LIMIT_WRITE_WINDOW_MS=60000
RATE_LIMIT_WRITE_MAX=30

GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=xxx
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:4010/api/v1/google/oauth/callback
GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY=dev-secret-change-in-prod

GOOGLE_ADS_DEVELOPER_TOKEN=xxx
GOOGLE_ADS_MANAGER_CUSTOMER_ID=123-456-7890
GOOGLE_ADS_API_VERSION=v18

GOOGLE_SHEETS_HTTP_TIMEOUT_MS=30000

INGESTION_MAX_RANGE_DAYS=365
INGESTION_RUN_STALE_MINUTES=180
SHEETS_RUN_STALE_MINUTES=240
SHEETS_MANUAL_MAX_RANGE_DAYS=180

SCHEDULER_POLL_SECONDS=30
SCHEDULER_CATCHUP_DAYS=3
SCHEDULER_REFRESH_DAYS=2
SCHEDULER_INITIAL_DELAY_SECONDS=10
```

### Production (Traefik + Docker)

```bash
NODE_ENV=production
PORT=4010
CORS_ORIGIN=https://adsmvp.workflo.space
DATABASE_URL=postgresql://ads_mvp_report:STRONG_PASSWORD@db:5432/ads_mvp_report?schema=public
DASHBOARD_ENABLED=true
PRISMA_MIGRATE_ON_START=true

APP_ALLOWED_GOOGLE_EMAILS=user1@example.com,user2@example.com
APP_SESSION_SECRET=GENERATED_RANDOM_STRING_32_CHARS
APP_SESSION_TTL_DAYS=6
RATE_LIMIT_AUTH_LOGIN_START_WINDOW_MS=60000
RATE_LIMIT_AUTH_LOGIN_START_MAX=20
RATE_LIMIT_WRITE_WINDOW_MS=60000
RATE_LIMIT_WRITE_MAX=30

GOOGLE_OAUTH_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=PROD_SECRET
GOOGLE_OAUTH_REDIRECT_URI=https://adsmvp.workflo.space/api/v1/google/oauth/callback
GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY=GENERATED_RANDOM_STRING_32_CHARS

GOOGLE_ADS_DEVELOPER_TOKEN=PROD_TOKEN
GOOGLE_ADS_MANAGER_CUSTOMER_ID=123-456-7890
GOOGLE_ADS_API_VERSION=v18

SHEETS_MANUAL_MAX_RANGE_DAYS=180

SCHEDULER_POLL_SECONDS=30
SCHEDULER_CATCHUP_DAYS=3
SCHEDULER_REFRESH_DAYS=2
SCHEDULER_INITIAL_DELAY_SECONDS=0
```

---

## Validation & Errors

### Schema Validation

All environment variables are validated via Zod schema in `src/config/env.ts`. Invalid values will cause startup error:

```
Error: Invalid environment configuration: NODE_ENV: Invalid enum value. Expected 'development' | 'test' | 'production'; PORT: Expected number, received string 'abc'
```

### Required vs Optional

**Always Required:**
- `DATABASE_URL`

**Required in Production:**
- `APP_ALLOWED_GOOGLE_EMAILS`
- `APP_SESSION_SECRET`
- `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`

**Required for Google Integration (if using OAuth):**
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`

**Required for Ads Ingestion:**
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_MANAGER_CUSTOMER_ID`

All others have sensible defaults.

---

## Tips & Troubleshooting

### Generating Random Secrets

```bash
openssl rand -hex 32
# Output: abcd1234efgh5678ijkl9012mnop3456qrst5678uvwx9012yzab3456cdef7890
```

### Testing Configuration

```bash
npm run typecheck  # Validates env.ts
npm run dev        # Starts app; will error if config invalid
```

### Changing Encryption Key

If you change `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`:
- All stored encrypted refresh tokens become unreadable
- Users must re-login to get new tokens
- Previous data in DB is lost (safely; just tokens can't be decrypted)

### Rate Limiting Too Strict?

Increase limits for development/testing:
```bash
RATE_LIMIT_WRITE_MAX=500           # Much higher for testing
RATE_LIMIT_AUTH_LOGIN_START_MAX=100
```

### Scheduler Not Running?

Check:
1. `SCHEDULER_INITIAL_DELAY_SECONDS` — should be 0 in production
2. `SCHEDULER_POLL_SECONDS` — at least 10 seconds
3. Logs: Look for "Scheduler started" message
4. `GET /api/v1/scheduler/health` — should show recent tick

---

**For API endpoints, see [FEATURES.md](./FEATURES.md)**  
**For overall architecture, see [OVERVIEW.md](./OVERVIEW.md)**  
**For testing details, see [TESTING.md](./TESTING.md)**
