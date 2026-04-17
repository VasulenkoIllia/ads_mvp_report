# Ads MVP Report — Features & API Reference

**Last Updated:** 2026-04-17

## API Base URL

All API endpoints are prefixed with `/api/v1/` and require authentication (except `/auth` endpoints listed below).

```
http://localhost:4010/api/v1/
```

---

## Authentication

### GET /auth/session

Returns the current authenticated user's session.

**Query Parameters:** None

**Response:**
```json
{
  "authenticated": true,
  "email": "user@example.com"
}
```

**Status Codes:**
- `200 OK` — Session is valid
- `401 Unauthorized` — No valid session (redirect to login)

---

### GET /auth/login/start

Initiates Google OAuth login flow.

**Rate Limited:** Yes (default 20 attempts per 60 seconds per IP)

**Response:**
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

**Usage:**
1. Frontend calls this endpoint
2. Gets `authUrl`
3. Redirects user to Google login
4. Google redirects back to `/api/v1/google/oauth/callback`
5. Backend creates session cookie

---

### POST /auth/logout

Destroys the current session.

**Rate Limited:** Yes (write endpoint)

**Response:**
```json
{
  "ok": true
}
```

**Usage:** After logout, user redirected to login page.

---

## Google Accounts & OAuth

### GET /google/status

Returns OAuth connection status and user info.

**Response:**
```json
{
  "connection": {
    "id": "GOOGLE",
    "status": "ACTIVE",
    "grantedEmail": "user@example.com",
    "scopesCsv": "https://www.googleapis.com/auth/adwords ...",
    "connectedAt": "2026-04-10T12:00:00Z",
    "tokenIssuedAt": "2026-04-15T10:30:00Z",
    "refreshTokenExpiresAt": "2027-04-15T10:30:00Z"
  },
  "warnings": []
}
```

Includes warnings like:
- `"OAuth token expiring in X days"` if `refreshTokenExpiresAt - now < GOOGLE_OAUTH_TOKEN_ALERT_DAYS`
- `"OAuth token expired"` if refresh failed

---

### GET /google/oauth/callback

OAuth callback endpoint (called by Google).

**Query Parameters:**
- `code` — Authorization code
- `state` — CSRF state token

**Behavior:**
1. Validates state token (must be recent and unused)
2. Exchanges code for tokens
3. Fetches user email via Google userinfo API
4. Validates email against `APP_ALLOWED_GOOGLE_EMAILS`
5. Encrypts refresh token, stores in DB
6. Sets `ads_mvp_session` cookie
7. Redirects to dashboard

---

### POST /google/accounts/sync

Syncs Google Ads MCC child accounts into the database.

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "run": {
    "id": "sync-run-123",
    "status": "SUCCESS",
    "totalSeen": 90,
    "discoveredCount": 10,
    "reappearedCount": 5,
    "detachedCount": 2,
    "startedAt": "2026-04-15T10:00:00Z",
    "finishedAt": "2026-04-15T10:05:00Z"
  }
}
```

**What it does:**
1. Uses Google Ads API to list all accounts under manager ID
2. Creates `AdsAccount` records for new accounts (status=ENABLED only)
3. Updates `lastSeenAt` for existing accounts
4. Marks accounts as detached if no longer in MCC

---

### GET /google/accounts

Lists all synced Google Ads accounts.

**Query Parameters:**
- `take` — Limit results (default 100, max 5000)

**Response:**
```json
{
  "accounts": [
    {
      "id": "account-id-123",
      "customerId": "123456789",
      "descriptiveName": "My Ads Account",
      "currencyCode": "USD",
      "timeZone": "Europe/London",
      "googleStatus": "ENABLED",
      "isManager": false,
      "ingestionEnabled": true,
      "createdAt": "2026-04-10T12:00:00Z",
      "firstSeenAt": "2026-04-10T12:00:00Z",
      "lastSeenAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

---

### PATCH /google/accounts/:accountId

Updates account settings (currently only `ingestionEnabled`).

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{
  "ingestionEnabled": false
}
```

**Response:**
```json
{
  "account": {
    "id": "account-id-123",
    "ingestionEnabled": false
  }
}
```

---

## Ingestion (Google Ads → DB)

### POST /ingestion/runs

**Triggers an ingestion run** to fetch campaign metrics from Google Ads API.

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{
  "dateFrom": "2026-04-10",
  "dateTo": "2026-04-15",
  "accountId": "123456789",
  "campaignId": "campaign-123",
  "takeAccounts": 5000,
  "batchSize": 100,
  "enabledOnly": true,
  "includeInactiveAccounts": false
}
```

**All parameters optional.** Defaults:
- `dateFrom` / `dateTo` — Yesterday only
- `accountId` — All accounts
- `campaignId` — All campaigns
- `takeAccounts` — 5000
- `batchSize` — 100 (per API call)
- `enabledOnly` — false (includes SUSPENDED/CANCELED)
- `includeInactiveAccounts` — false

**Response:**
```json
{
  "run": {
    "id": "run-456",
    "runDate": "2026-04-15",
    "dateFrom": "2026-04-10",
    "dateTo": "2026-04-15",
    "status": "RUNNING",
    "triggerSource": "MANUAL",
    "totalAccounts": 57,
    "processedAccounts": 0,
    "successAccounts": 0,
    "failedAccounts": 0,
    "rowsUpserted": 0,
    "startedAt": "2026-04-15T10:00:00Z"
  }
}
```

**Status values:** `RUNNING` → `SUCCESS`, `FAILED`, `PARTIAL`, `CANCELLED`

**What it does:**
1. Acquires advisory lock (prevents concurrent runs)
2. Fetches list of eligible accounts (filtered by `ingestionEnabled`, account ID, etc.)
3. For each account/date combination, queries Google Ads GAQL API
4. Parses response: impressions, clicks, cost, conversions, conversion value, etc.
5. Upserts rows into `CampaignDailyFact` table (unique key: date + account + campaign)
6. Updates run status and row count
7. Returns summarized response

**GAQL Query:**
```sql
SELECT
  campaign.id, campaign.name, campaign.status,
  campaign.final_url_suffix, campaign.tracking_url_template,
  metrics.impressions, metrics.clicks, metrics.ctr,
  metrics.average_cpc, metrics.cost_micros,
  metrics.conversions, metrics.cost_per_conversion,
  metrics.conversions_value
FROM campaign
WHERE segments.date = '2026-04-15'
```

---

### GET /ingestion/preflight

Validates an ingestion request without executing it.

**Query Parameters:** Same as `POST /ingestion/runs`

**Response:**
```json
{
  "eligibleAccounts": 57,
  "dateFrom": "2026-04-10",
  "dateTo": "2026-04-15",
  "estimatedRunDurationSeconds": 45
}
```

Useful for checking parameter validity before triggering a long run.

---

### GET /ingestion/runs

Lists ingestion run history.

**Query Parameters:**
- `status` — Filter by status (RUNNING, SUCCESS, FAILED, PARTIAL, CANCELLED)
- `triggerSource` — MANUAL or SCHEDULER
- `runDate` — Filter by run date (YYYY-MM-DD)
- `take` — Limit results (max 100)

**Response:**
```json
{
  "runs": [
    {
      "id": "run-456",
      "runDate": "2026-04-15",
      "status": "SUCCESS",
      "triggerSource": "SCHEDULER",
      "totalAccounts": 57,
      "successAccounts": 57,
      "failedAccounts": 0,
      "rowsUpserted": 1234,
      "startedAt": "2026-04-15T01:00:00Z",
      "finishedAt": "2026-04-15T01:02:30Z"
    }
  ]
}
```

---

### GET /ingestion/runs/active

Returns the currently executing ingestion run, if any.

**Response (if running):**
```json
{
  "id": "run-456",
  "runDate": "2026-04-15",
  "status": "RUNNING",
  "totalAccounts": 57,
  "processedAccounts": 34,
  "successAccounts": 32,
  "failedAccounts": 2,
  "rowsUpserted": 890,
  "startedAt": "2026-04-15T10:00:00Z"
}
```

**Response (if idle):**
```json
null
```

Frontend uses this endpoint with adaptive polling (fast when active, slow when idle).

---

### GET /ingestion/runs/:runId

Gets details of a specific ingestion run.

**Response:**
```json
{
  "run": { /* as above */ },
  "accountRuns": [
    {
      "id": "acct-run-123",
      "adsAccountId": "account-123",
      "adsAccountName": "My Ads Account",
      "runDate": "2026-04-15",
      "status": "SUCCESS",
      "rowsUpserted": 45,
      "startedAt": "2026-04-15T10:00:00Z",
      "finishedAt": "2026-04-15T10:00:30Z"
    }
  ]
}
```

---

### GET /ingestion/coverage

**Returns data freshness per account** — used by frontend "Дані до" column.

**Response:**
```json
{
  "accounts": [
    {
      "accountId": "account-123",
      "descriptiveName": "My Ads Account",
      "lastFactDate": "2026-04-15",
      "hasDataForYesterday": true,
      "staleDays": 0
    },
    {
      "accountId": "account-456",
      "descriptiveName": "Another Account",
      "lastFactDate": "2026-04-13",
      "hasDataForYesterday": false,
      "staleDays": 2
    }
  ]
}
```

**Fields:**
- `lastFactDate` — Latest date with data (YYYY-MM-DD format)
- `hasDataForYesterday` — Boolean: is yesterday's date present?
- `staleDays` — Days since last fact (0 = today, 1 = yesterday, etc.)

---

### GET /ingestion/facts

Lists raw campaign daily facts from the database.

**Query Parameters:**
- `accountId` — Filter by account (required if listing all)
- `dateFrom` — Start date (YYYY-MM-DD)
- `dateTo` — End date (YYYY-MM-DD)
- `take` — Limit results (max 2000)

**Response:**
```json
{
  "facts": [
    {
      "id": "fact-123",
      "factDate": "2026-04-15",
      "customerId": "123456789",
      "campaignId": "campaign-id",
      "campaignName": "My Campaign",
      "campaignStatus": "ENABLED",
      "impressions": 1000,
      "clicks": 50,
      "ctrPercent": 5.0,
      "averageCpc": 1.20,
      "cost": 60.00,
      "conversions": 5,
      "costPerConversion": 12.00,
      "conversionValue": 250.00,
      "conversionValuePerCost": 4.17,
      "finalUrlSuffix": "utm_campaign=test",
      "trackingUrlTemplate": "https://...",
      "utmSource": "google",
      "utmMedium": "cpc"
    }
  ]
}
```

---

### GET /ingestion/preview

Preview facts for a specific campaign (useful for debugging).

**Query Parameters:**
- `accountId` — Account ID (required)
- `campaignId` — Campaign ID (optional)
- `dateFrom` — Start date (YYYY-MM-DD)
- `dateTo` — End date (YYYY-MM-DD)
- `take` — Limit results (max 500)

**Response:** Same as `/ingestion/facts`

---

### GET /ingestion/health

Summary of recent ingestion runs.

**Response:**
```json
{
  "lastSuccessRunDate": "2026-04-15",
  "lastSuccessAt": "2026-04-15T01:05:00Z",
  "recentRunsSummary": {
    "total": 5,
    "successful": 4,
    "failed": 1
  }
}
```

---

### GET /ingestion/options

Returns API metadata (enums, limits).

**Response:**
```json
{
  "enums": {
    "runStatuses": ["RUNNING", "SUCCESS", "FAILED", "PARTIAL", "CANCELLED"],
    "triggerSources": ["MANUAL", "SCHEDULER"]
  },
  "limits": {
    "dateFormat": "YYYY-MM-DD",
    "maxRangeDays": 365,
    "takeAccounts": { "min": 1, "max": 20000, "default": 5000 },
    "batchSize": { "min": 10, "max": 500, "default": 100 }
  }
}
```

---

## Campaigns

### POST /campaigns/sync

Syncs campaigns for all or one account from Google Ads API.

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{
  "accountId": "account-123"
}
```

`accountId` optional; if omitted, syncs all accounts.

**Response:**
```json
{
  "runs": [
    {
      "adsAccountId": "account-123",
      "status": "SUCCESS",
      "totalSeen": 42,
      "discoveredCount": 3,
      "updatedCount": 2,
      "startedAt": "2026-04-15T10:00:00Z",
      "finishedAt": "2026-04-15T10:00:15Z"
    }
  ]
}
```

---

### GET /campaigns

Lists all campaigns.

**Query Parameters:**
- `accountId` — Filter by account
- `status` — Filter by campaign status (ENABLED, PAUSED, REMOVED)
- `q` — Search by campaign name (case-insensitive contains)
- `take` — Limit results (max 5000)

**Response:**
```json
{
  "campaigns": [
    {
      "id": "campaign-id-123",
      "adsAccountId": "account-123",
      "campaignId": "campaign-id",
      "campaignName": "My Campaign",
      "campaignStatus": "ENABLED",
      "advertisingChannel": "SEARCH",
      "createdAt": "2026-04-10T12:00:00Z",
      "lastSeenAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

---

### GET /campaigns/sync-runs

Lists campaign sync run history.

**Query Parameters:**
- `accountId` — Filter by account
- `take` — Limit results (max 200)

**Response:**
```json
{
  "runs": [
    {
      "id": "sync-run-456",
      "adsAccountId": "account-123",
      "status": "SUCCESS",
      "totalSeen": 42,
      "discoveredCount": 3,
      "startedAt": "2026-04-15T10:00:00Z",
      "finishedAt": "2026-04-15T10:00:15Z"
    }
  ]
}
```

---

## Sheets (Google Sheets Export)

### GET /sheets/columns-catalog

Returns all available columns for Sheets export.

**Response:**
```json
{
  "columns": [
    {
      "key": "date",
      "label": "Date",
      "type": "string",
      "numeric": false
    },
    {
      "key": "customer_id",
      "label": "Customer ID",
      "type": "string",
      "numeric": false
    },
    {
      "key": "impressions",
      "label": "Impressions",
      "type": "number",
      "numeric": true
    },
    {
      "key": "cost",
      "label": "Cost",
      "type": "number",
      "numeric": true
    },
    {
      "key": "conversions",
      "label": "Conversions",
      "type": "number",
      "numeric": true
    },
    {
      "key": "conversion_value",
      "label": "Conversion Value",
      "type": "number",
      "numeric": true
    },
    {
      "key": "conversion_value_per_cost",
      "label": "ROAS (Return on Ad Spend)",
      "type": "number",
      "numeric": true
    }
  ]
}
```

**Available columns:** date, customer_id, account_name, campaign_id, campaign_name, campaign_status, impressions, clicks, ctr_percent, average_cpc, cost, conversions, cost_per_conversion, conversion_value, conversion_value_per_cost, final_url_suffix, tracking_url_template, utm_source, utm_medium, utm_campaign, utm_term, utm_content

---

### GET /sheets/configs

Lists all Sheets export configs.

**Query Parameters:**
- `accountId` — Filter by account
- `active` — Filter by active status (true/false)
- `take` — Limit results (max 500)

**Response:**
```json
{
  "configs": [
    {
      "id": "config-123",
      "adsAccountId": "account-123",
      "spreadsheetId": "1ABC...",
      "sheetName": "April 2026",
      "writeMode": "UPSERT",
      "dataMode": "CAMPAIGN",
      "columnMode": "ALL",
      "selectedColumns": [],
      "campaignStatuses": [],
      "active": true,
      "createdAt": "2026-04-10T12:00:00Z"
    }
  ]
}
```

---

### PUT /sheets/configs/:accountId

Creates or updates a Sheets export config.

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{
  "configId": "config-123",
  "createNew": false,
  "spreadsheetId": "1ABC...",
  "sheetName": "April 2026",
  "writeMode": "UPSERT",
  "dataMode": "CAMPAIGN",
  "columnMode": "ALL",
  "selectedColumns": ["date", "campaign_name", "cost", "conversions"],
  "campaignStatuses": ["ENABLED"],
  "active": true
}
```

**Parameters:**
- `configId` — Update existing (optional if `createNew: true`)
- `createNew` — Create new (optional if `configId` provided)
- `spreadsheetId` — Google Sheet ID (required, min 10 chars)
- `sheetName` — Tab name (required, 1-120 chars)
- `writeMode` — Only `UPSERT` supported currently
- `dataMode` — `CAMPAIGN` (per-row per-campaign) or `DAILY_TOTAL` (one row per day)
- `columnMode` — `ALL` (use all available) or `MANUAL` (use `selectedColumns`)
- `selectedColumns` — Array of column keys (required if `columnMode: MANUAL`)
- `campaignStatuses` — Filter by status (empty = no filter)
- `active` — Enable auto-export for this config

**Response:** Same as GET request

---

### DELETE /sheets/configs/:configId

Deletes a Sheets export config.

**Rate Limited:** Yes (write endpoint)

**Response:**
```json
{
  "ok": true
}
```

---

### POST /sheets/runs

**Triggers Sheets export** using all active configs (or a single account/date).

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{
  "accountId": "account-123",
  "runDate": "2026-04-15"
}
```

Both parameters optional; defaults to yesterday and all active configs.

**Response:**
```json
{
  "runs": [
    {
      "id": "export-456",
      "runDate": "2026-04-15",
      "status": "RUNNING",
      "triggerSource": "MANUAL",
      "configId": "config-123",
      "rowsPrepared": 0,
      "rowsWritten": 0,
      "startedAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

---

### POST /sheets/runs/manual

**One-time ad-hoc Sheets export** for a single date.

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{
  "runDate": "2026-04-15",
  "accountId": "account-123",
  "spreadsheetId": "1ABC...",
  "sheetName": "April 2026",
  "writeMode": "UPSERT",
  "dataMode": "CAMPAIGN",
  "columnMode": "ALL",
  "selectedColumns": ["date", "campaign_name", "cost", "conversions"],
  "campaignStatuses": ["ENABLED"],
  "campaignNameSearch": "pmax"
}
```

**New Parameter:**
- `campaignNameSearch` — Case-insensitive substring filter on campaign name (e.g., "pmax" matches "My PMAX Campaign")

**Response:**
```json
{
  "run": {
    "id": "export-456",
    "runDate": "2026-04-15",
    "status": "RUNNING",
    "triggerSource": "MANUAL",
    "rowsPrepared": 0,
    "rowsWritten": 0,
    "startedAt": "2026-04-15T10:00:00Z"
  }
}
```

---

### POST /sheets/manual-range-runs

**Multi-day ad-hoc Sheets export** — spans multiple dates with backend job handling.

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{
  "accountId": "account-123",
  "dateFrom": "2026-04-10",
  "dateTo": "2026-04-15",
  "spreadsheetId": "1ABC...",
  "sheetName": "April 2026",
  "writeMode": "UPSERT",
  "dataMode": "CAMPAIGN",
  "columnMode": "ALL",
  "selectedColumns": ["date", "campaign_name", "cost", "conversions"],
  "campaignStatuses": ["ENABLED"],
  "campaignNameSearch": "pmax"
}
```

**Response:**
```json
{
  "run": {
    "id": "range-run-789",
    "adsAccountId": "account-123",
    "spreadsheetId": "1ABC...",
    "sheetName": "April 2026",
    "dateFrom": "2026-04-10",
    "dateTo": "2026-04-15",
    "totalDays": 6,
    "completedDays": 0,
    "successDays": 0,
    "failedDays": 0,
    "status": "RUNNING",
    "startedAt": "2026-04-15T10:00:00Z"
  }
}
```

**Max Range:** `SHEETS_MANUAL_MAX_RANGE_DAYS` (default 180 days)

---

### GET /sheets/manual-range-runs

Lists manual range run history.

**Query Parameters:**
- `accountId` — Filter by account
- `status` — Filter by status
- `take` — Limit results (max 200)

**Response:**
```json
{
  "runs": [
    {
      "id": "range-run-789",
      "adsAccountId": "account-123",
      "dateFrom": "2026-04-10",
      "dateTo": "2026-04-15",
      "totalDays": 6,
      "completedDays": 3,
      "successDays": 3,
      "failedDays": 0,
      "status": "RUNNING",
      "startedAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

---

### GET /sheets/manual-range-runs/:runId

Gets progress of a specific range run.

**Response:**
```json
{
  "run": { /* as above */ },
  "dayRuns": [
    {
      "id": "day-run-123",
      "runDate": "2026-04-10",
      "status": "SUCCESS",
      "rowsPrepared": 45,
      "rowsWritten": 45,
      "startedAt": "2026-04-15T10:00:00Z",
      "finishedAt": "2026-04-15T10:00:30Z"
    }
  ]
}
```

---

### GET /sheets/runs

Lists all Sheets export runs.

**Query Parameters:**
- `accountId` — Filter by account
- `status` — Filter by status
- `triggerSource` — MANUAL or SCHEDULER
- `take` — Limit results (max 200)

**Response:**
```json
{
  "runs": [
    {
      "id": "export-456",
      "runDate": "2026-04-15",
      "status": "SUCCESS",
      "triggerSource": "SCHEDULER",
      "rowsPrepared": 50,
      "rowsWritten": 50,
      "rowsSkipped": 0,
      "startedAt": "2026-04-15T01:10:00Z",
      "finishedAt": "2026-04-15T01:10:45Z"
    }
  ]
}
```

---

### GET /sheets/runs/:runId

Gets details of a specific export run.

**Response:**
```json
{
  "run": { /* as above */ }
}
```

---

### GET /sheets/preview

Previews rows that would be exported (without actually writing).

**Query Parameters:**
- `accountId` — Account ID (required)
- `dateFrom` — Start date (YYYY-MM-DD, required)
- `dateTo` — End date (YYYY-MM-DD, required)
- `dataMode` — CAMPAIGN or DAILY_TOTAL
- `columnMode` — ALL or MANUAL
- `selectedColumns` — Comma-separated column keys (required if MANUAL)
- `campaignStatuses` — Comma-separated statuses (optional)
- `campaignNameSearch` — Search string (optional)
- `take` — Limit preview rows (max 500)

**Example:**
```
GET /sheets/preview?accountId=acct-123&dateFrom=2026-04-15&dateTo=2026-04-15&columnMode=MANUAL&selectedColumns=date,campaign_name,cost&campaignNameSearch=pmax
```

**Response:**
```json
{
  "preview": {
    "selectedColumns": ["date", "campaign_name", "cost"],
    "rows": [
      ["2026-04-15", "My PMAX Campaign", 150.50],
      ["2026-04-15", "Another PMAX", 89.25]
    ]
  }
}
```

---

### GET /sheets/health

Summary of recent Sheets export runs.

**Response:**
```json
{
  "lastSuccessRunDate": "2026-04-15",
  "lastSuccessAt": "2026-04-15T01:10:45Z",
  "recentRunsSummary": {
    "total": 10,
    "successful": 9,
    "failed": 1
  },
  "runs": {
    "running": 0,
    "queued": 0
  }
}
```

---

### GET /sheets/options

Returns API metadata (enums, defaults, limits).

**Response:**
```json
{
  "enums": {
    "writeModes": ["UPSERT"],
    "dataModes": ["CAMPAIGN", "DAILY_TOTAL"],
    "columnModes": ["ALL", "MANUAL"],
    "runStatuses": ["RUNNING", "SUCCESS", "FAILED", "PARTIAL", "SKIPPED", "CANCELLED"],
    "triggerSources": ["MANUAL", "SCHEDULER"]
  },
  "defaults": {
    "writeMode": "UPSERT",
    "dataMode": "CAMPAIGN",
    "columnMode": "ALL"
  },
  "limits": {
    "dateFormat": "YYYY-MM-DD",
    "selectedColumnsMax": 40,
    "campaignStatusesMax": 20
  }
}
```

---

## Scheduler

### GET /scheduler/settings

Returns current scheduler configuration.

**Response:**
```json
{
  "settings": {
    "id": "GLOBAL",
    "timezone": "Europe/Kyiv",
    "ingestionEnabled": true,
    "ingestionHour": 1,
    "ingestionMinute": 0,
    "ingestionMaxDailyAttempts": 2,
    "ingestionRetryDelayMin": 20,
    "ingestionBatchSize": 100,
    "ingestionMaxAccounts": 5000,
    "sheetsEnabled": true,
    "sheetsHour": 1,
    "sheetsMinute": 10,
    "sheetsMaxDailyAttempts": 2,
    "sheetsRetryDelayMin": 20,
    "sheetsMaxConfigsPerTick": 200
  }
}
```

---

### PATCH /scheduler/settings

Updates scheduler settings.

**Rate Limited:** Yes (write endpoint)

**Request Body:**
```json
{
  "timezone": "Europe/Kyiv",
  "ingestionEnabled": true,
  "ingestionHour": 1,
  "ingestionMinute": 0,
  "sheetsEnabled": true,
  "sheetsHour": 1,
  "sheetsMinute": 10
}
```

All fields optional; only specified fields are updated.

**Response:** Same as GET

---

### GET /scheduler/health

Health status of scheduler.

**Response:**
```json
{
  "schedulerRunning": true,
  "lastTickAt": "2026-04-15T10:30:00Z",
  "tickCount": 12345,
  "nextScheduledIngestionTime": "2026-04-16T01:00:00Z",
  "nextScheduledSheetsTime": "2026-04-16T01:10:00Z"
}
```

---

## Status Codes & Error Handling

### Success Responses

- `200 OK` — Request succeeded
- `201 Created` — Resource created (not used currently, but valid)

### Client Errors

- `400 Bad Request` — Validation error (invalid JSON, parameters, date format)
- `401 Unauthorized` — Not authenticated (no valid session)
- `403 Forbidden` — CORS origin blocked
- `404 Not Found` — Route or resource not found

### Server Errors

- `500 Internal Server Error` — Unhandled error

### Error Response Format

```json
{
  "message": "Human-readable error message",
  "errorCode": "SPECIFIC_ERROR_CODE",
  "details": null
}
```

**Common Error Codes:**
- `DB_SCHEMA_OUTDATED` — Run `npm run db:migrate:deploy`
- `GOOGLE_ADS_QUOTA_EXHAUSTED` — Quota exceeded; retry after delay
- `GOOGLE_SHEETS_QUOTA_EXHAUSTED` — Sheets quota; retry after delay
- `INVALID_DATE_RANGE` — Dates out of bounds
- `CONFIG_NOT_FOUND` — Config ID doesn't exist

---

## Frontend Features

### UI Components & Pages

1. **OverviewPage** — Dashboard with status cards, recent runs, alerts
2. **AccountsPage** — List of accounts with "Дані до" (data freshness) column
3. **CampaignsPage** — Campaign browser by account/status
4. **IngestionPage** — Manual ingestion trigger + live progress panel
5. **SheetsPage** — Config management + manual export form with campaign name filter
6. **SchedulerPage** — Scheduler settings, catchup/refresh explanation

### Key Hooks & Components

- **usePolling** — Adaptive polling hook (fast 3s when active, slow 30s when idle)
- **RunningBanner** — Global banner showing live ingestion/sheets progress (top of page)
- **Page Suspense** — All pages lazy-loaded with Suspense fallback

### Localization

- **Language:** Ukrainian (Ant Design locale `uk_UA`)
- **UI Terms:**
  - "Завантаження" (Loading) for ingestion, not "Інгестія"
  - "Дані" (Data) for ingestion in sidebar
  - "Планувальник" (Scheduler) in sidebar

---

**For overall architecture, see [OVERVIEW.md](./OVERVIEW.md)**  
**For environment configuration, see [CONFIGURATION.md](./CONFIGURATION.md)**  
**For testing details, see [TESTING.md](./TESTING.md)**
