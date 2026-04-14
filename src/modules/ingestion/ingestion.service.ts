import axios from 'axios';
import {
  IngestionAccountRunStatus,
  IngestionRunStatus,
  OAuthConnectionStatus,
  TriggerSource,
  type Prisma
} from '@prisma/client';
import { env } from '../../config/env.js';
import { ApiError } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import {
  addUtcDays,
  daysBetweenInclusive,
  getDefaultYesterdayRunDate,
  getUtcDayWindow,
  parseDateOnlyToUtcDayStart,
  toDateOnlyString
} from '../../lib/timezone.js';
import { getGoogleAdsRuntimeCredentials } from '../google/google.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const ACTIVE_GOOGLE_ACCOUNT_STATUS = 'ENABLED';
const ACTIVE_CAMPAIGN_STATUS = 'ENABLED';
const INGESTION_START_LOCK_KEY = 10401001n;

type CampaignRow = {
  campaign?: {
    id?: string | number;
    name?: string;
    status?: string;
    finalUrlSuffix?: string;
    final_url_suffix?: string;
    trackingUrlTemplate?: string;
    tracking_url_template?: string;
  };
  campaign_?: {
    id?: string | number;
    name?: string;
    status?: string;
    final_url_suffix?: string;
    tracking_url_template?: string;
  };
  metrics?: {
    impressions?: number | string;
    clicks?: number | string;
    ctr?: number | string;
    averageCpc?: number | string;
    average_cpc?: number | string;
    costMicros?: number | string;
    cost_micros?: number | string;
    conversions?: number | string;
    conversionsValue?: number | string;
    conversions_value?: number | string;
    costPerConversion?: number | string;
    cost_per_conversion?: number | string;
    conversionsValuePerCost?: number | string;
    conversions_value_per_cost?: number | string;
  };
  metrics_?: {
    impressions?: number | string;
    clicks?: number | string;
    ctr?: number | string;
    average_cpc?: number | string;
    cost_micros?: number | string;
    conversions?: number | string;
    conversions_value?: number | string;
    cost_per_conversion?: number | string;
    conversions_value_per_cost?: number | string;
  };
};

type CampaignBatch = {
  results?: CampaignRow[];
};

type IngestionFactRow = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  impressions: number;
  clicks: number;
  ctrPercent: number;
  averageCpc: number;
  cost: number;
  conversions: number;
  costPerConversion: number;
  conversionValue: number;
  conversionValuePerCost: number;
  finalUrlSuffix: string | null;
  trackingUrlTemplate: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
};

type IngestionRunWindow = {
  runDate: string;
  dateFrom: string;
  dateTo: string;
  totalDays: number;
};

export type RunGoogleAdsIngestionParams = {
  runDate?: string;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  takeAccounts?: number;
  batchSize?: number;
  enabledOnly?: boolean;
  triggerSource?: TriggerSource;
};

type IngestionEligibleAccount = {
  id: string;
  customerId: string;
  descriptiveName: string;
};

type IngestionPreflightResult = {
  runWindow: IngestionRunWindow;
  canRun: boolean;
  reason: string | null;
  staleRunsAutoFailed: number;
  oauth: {
    configured: boolean;
    connected: boolean;
    ready: boolean;
    managerCustomerId: string | null;
    grantedEmail: string | null;
    refreshTokenExpiresAt: string | null;
    tokenDaysLeft: number | null;
  };
  limits: {
    requestedAccounts: number;
    selectedAccounts: number;
    batchSize: number;
    maxRangeDays: number;
    enabledOnly: boolean;
  };
  runningRun: {
    id: string;
    runDate: string;
    startedAt: string;
    ageMinutes: number;
  } | null;
};

function toErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const payload =
      typeof error.response?.data === 'string'
        ? error.response.data
        : JSON.stringify(error.response?.data ?? error.message);

    return status ? `${status}: ${payload}` : payload;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  return [408, 429, 500, 502, 503, 504].includes(error.response.status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= env.GOOGLE_ADS_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === env.GOOGLE_ADS_RETRY_ATTEMPTS || !isRetryable(error)) {
        throw error;
      }

      const backoff = env.GOOGLE_ADS_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
      await sleep(backoff);
    }
  }

  throw lastError;
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function parseInteger(value: unknown): number {
  return Math.max(0, Math.round(parseNumber(value)));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function microsToCurrency(value: unknown): number {
  return roundTo(parseNumber(value) / 1_000_000, 2);
}

function normalizeCtrPercent(value: unknown): number {
  const numeric = parseNumber(value);
  const normalized = numeric <= 1 ? numeric * 100 : numeric;
  return roundTo(normalized, 2);
}

function normalizeCampaignId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value).toString();
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

type UtmTokens = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
};

function emptyUtmTokens(): UtmTokens {
  return {
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null
  };
}

function parseUtmTokens(raw: string | null): UtmTokens {
  if (!raw) {
    return emptyUtmTokens();
  }

  const normalized = raw.trim();
  if (normalized.length === 0) {
    return emptyUtmTokens();
  }

  const withoutFragment = normalized.split('#')[0];
  const queryCandidate = withoutFragment.includes('?')
    ? withoutFragment.slice(withoutFragment.indexOf('?') + 1)
    : withoutFragment.startsWith('?')
      ? withoutFragment.slice(1)
      : withoutFragment;

  const params = new URLSearchParams(queryCandidate);
  const result = emptyUtmTokens();

  for (const [key, value] of params.entries()) {
    const normalizedKey = key.trim().toLowerCase();
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      continue;
    }

    if (normalizedKey === 'utm_source') {
      result.utmSource = normalizedValue;
      continue;
    }

    if (normalizedKey === 'utm_medium') {
      result.utmMedium = normalizedValue;
      continue;
    }

    if (normalizedKey === 'utm_campaign') {
      result.utmCampaign = normalizedValue;
      continue;
    }

    if (normalizedKey === 'utm_term') {
      result.utmTerm = normalizedValue;
      continue;
    }

    if (normalizedKey === 'utm_content') {
      result.utmContent = normalizedValue;
      continue;
    }
  }

  return result;
}

function mergeUtm(primary: UtmTokens, secondary: UtmTokens): UtmTokens {
  return {
    utmSource: primary.utmSource ?? secondary.utmSource,
    utmMedium: primary.utmMedium ?? secondary.utmMedium,
    utmCampaign: primary.utmCampaign ?? secondary.utmCampaign,
    utmTerm: primary.utmTerm ?? secondary.utmTerm,
    utmContent: primary.utmContent ?? secondary.utmContent
  };
}

function parseCampaignRows(payload: unknown): IngestionFactRow[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const rows: IngestionFactRow[] = [];

  for (const batch of payload as CampaignBatch[]) {
    const items = Array.isArray(batch.results) ? batch.results : [];

    for (const item of items) {
      const campaign = item.campaign ?? item.campaign_;
      const metrics = (item.metrics ?? item.metrics_) as Record<string, unknown> | undefined;

      if (!campaign || !metrics) {
        continue;
      }

      const campaignId = normalizeCampaignId(campaign.id);
      if (!campaignId) {
        continue;
      }

      const finalUrlSuffix = normalizeOptionalText(item.campaign?.finalUrlSuffix ?? campaign.final_url_suffix);
      const trackingUrlTemplate = normalizeOptionalText(
        item.campaign?.trackingUrlTemplate ?? campaign.tracking_url_template
      );
      const costRaw = parseNumber(metrics.costMicros ?? metrics.cost_micros) / 1_000_000;
      const conversionValueRaw = parseNumber(metrics.conversionsValue ?? metrics.conversions_value);

      rows.push({
        campaignId,
        campaignName:
          typeof campaign.name === 'string' && campaign.name.trim().length > 0
            ? campaign.name
            : `Campaign ${campaignId}`,
        campaignStatus:
          typeof campaign.status === 'string' && campaign.status.trim().length > 0
            ? campaign.status
            : 'UNKNOWN',
        impressions: parseInteger(metrics.impressions),
        clicks: parseInteger(metrics.clicks),
        ctrPercent: normalizeCtrPercent(metrics.ctr),
        averageCpc: microsToCurrency(metrics.averageCpc ?? metrics.average_cpc),
        cost: roundTo(costRaw, 2),
        conversions: roundTo(parseNumber(metrics.conversions), 2),
        costPerConversion: microsToCurrency(metrics.costPerConversion ?? metrics.cost_per_conversion),
        conversionValue: roundTo(conversionValueRaw, 2),
        // `metrics.conversions_value_per_cost` can fail for CAMPAIGN in some API combinations.
        // Keep ingestion stable by deriving the ratio from returned conversion value and cost.
        conversionValuePerCost: costRaw > 0 ? roundTo(conversionValueRaw / costRaw, 2) : 0,
        finalUrlSuffix,
        trackingUrlTemplate,
        ...mergeUtm(parseUtmTokens(finalUrlSuffix), parseUtmTokens(trackingUrlTemplate))
      });
    }
  }

  return rows;
}

function buildRunWindow(params: { runDate?: string; dateFrom?: string; dateTo?: string }): IngestionRunWindow {
  const hasRange = Boolean(params.dateFrom || params.dateTo);

  if (params.runDate && hasRange) {
    throw new ApiError(400, 'Use either runDate or dateFrom/dateTo.');
  }

  if (hasRange) {
    if (!params.dateFrom || !params.dateTo) {
      throw new ApiError(400, 'Both dateFrom and dateTo are required for range ingestion.');
    }

    let start: Date;
    let end: Date;

    try {
      start = parseDateOnlyToUtcDayStart(params.dateFrom);
      end = parseDateOnlyToUtcDayStart(params.dateTo);
    } catch {
      throw new ApiError(400, 'dateFrom/dateTo must be valid YYYY-MM-DD values.');
    }

    if (start.getTime() > end.getTime()) {
      throw new ApiError(400, 'dateFrom must be less than or equal to dateTo.');
    }

    const totalDays = daysBetweenInclusive(start, end);
    if (totalDays > env.INGESTION_MAX_RANGE_DAYS) {
      throw new ApiError(
        400,
        `Requested range is too large (${totalDays} day(s)). Max allowed: ${env.INGESTION_MAX_RANGE_DAYS} day(s).`
      );
    }

    return {
      runDate: toDateOnlyString(start),
      dateFrom: toDateOnlyString(start),
      dateTo: toDateOnlyString(end),
      totalDays
    };
  }

  let runDate: Date;

  try {
    runDate = params.runDate
      ? parseDateOnlyToUtcDayStart(params.runDate)
      : getDefaultYesterdayRunDate(new Date(), 'Europe/Kyiv');
  } catch {
    throw new ApiError(400, 'runDate must be valid YYYY-MM-DD.');
  }

  const runDateText = toDateOnlyString(runDate);

  return {
    runDate: runDateText,
    dateFrom: runDateText,
    dateTo: runDateText,
    totalDays: 1
  };
}

function clampTakeAccounts(value: number | undefined): number {
  const requested = Math.max(1, Math.round(value ?? 5000));
  return Math.min(requested, 20000);
}

function clampBatchSize(value: number | undefined): number {
  const requested = Math.max(10, Math.round(value ?? 100));
  return Math.min(requested, 500);
}

function buildEligibleAccountsWhere(params: { accountId?: string; enabledOnly?: boolean }): Prisma.AdsAccountWhereInput {
  const where: Prisma.AdsAccountWhereInput = {
    isInMcc: true,
    isManager: false,
    googleStatus: ACTIVE_GOOGLE_ACCOUNT_STATUS
  };

  if (params.enabledOnly ?? true) {
    where.ingestionEnabled = true;
  }

  if (params.accountId) {
    where.id = params.accountId;
  }

  return where;
}

function getRunDates(window: IngestionRunWindow): Date[] {
  const start = parseDateOnlyToUtcDayStart(window.dateFrom);
  const values: Date[] = [];

  for (let offset = 0; offset < window.totalDays; offset += 1) {
    values.push(addUtcDays(start, offset));
  }

  return values;
}

function deriveRunStatus(params: {
  processedAccounts: number;
  failedAccounts: number;
}): IngestionRunStatus {
  if (params.processedAccounts === 0) {
    return IngestionRunStatus.FAILED;
  }

  if (params.failedAccounts === 0) {
    return IngestionRunStatus.SUCCESS;
  }

  if (params.failedAccounts === params.processedAccounts) {
    return IngestionRunStatus.FAILED;
  }

  return IngestionRunStatus.PARTIAL;
}

async function fetchCampaignMetricsForDate(params: {
  accessToken: string;
  developerToken: string;
  managerCustomerId: string;
  customerId: string;
  runDate: string;
}): Promise<IngestionFactRow[]> {
  const endpoint = `https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}/customers/${params.customerId}/googleAds:searchStream`;

  const query = `SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.final_url_suffix,
  campaign.tracking_url_template,
  metrics.impressions,
  metrics.clicks,
  metrics.ctr,
  metrics.average_cpc,
  metrics.cost_micros,
  metrics.conversions,
  metrics.cost_per_conversion,
  metrics.conversions_value
FROM campaign
WHERE segments.date = '${params.runDate}'
  AND campaign.status = '${ACTIVE_CAMPAIGN_STATUS}'`;

  const response = await withRetries(() =>
    axios.post<CampaignBatch[]>(
      endpoint,
      { query },
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'developer-token': params.developerToken,
          'login-customer-id': params.managerCustomerId,
          'Content-Type': 'application/json'
        },
        timeout: env.GOOGLE_ADS_HTTP_TIMEOUT_MS
      }
    )
  );

  return parseCampaignRows(response.data);
}

async function processAccountForDate(params: {
  runId: string;
  runDate: Date;
  runDateText: string;
  account: IngestionEligibleAccount;
  credentials: Awaited<ReturnType<typeof getGoogleAdsRuntimeCredentials>>;
}): Promise<{
  status: IngestionAccountRunStatus;
  rowsUpserted: number;
  error: string | null;
}> {
  const accountRun = await prisma.ingestionAccountRun.create({
    data: {
      runId: params.runId,
      adsAccountId: params.account.id,
      runDate: params.runDate,
      status: IngestionAccountRunStatus.RUNNING
    },
    select: {
      id: true
    }
  });

  try {
    const rows = await fetchCampaignMetricsForDate({
      accessToken: params.credentials.accessToken,
      developerToken: params.credentials.developerToken,
      managerCustomerId: params.credentials.managerCustomerId,
      customerId: params.account.customerId,
      runDate: params.runDateText
    });

    if (rows.length === 0) {
      await prisma.ingestionAccountRun.update({
        where: {
          id: accountRun.id
        },
        data: {
          status: IngestionAccountRunStatus.SKIPPED,
          rowsUpserted: 0,
          finishedAt: new Date(),
          errorSummary: 'No campaign rows for selected date.'
        }
      });

      return {
        status: IngestionAccountRunStatus.SKIPPED,
        rowsUpserted: 0,
        error: null
      };
    }

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.campaignDailyFact.upsert({
          where: {
            factDate_adsAccountId_campaignId: {
              factDate: params.runDate,
              adsAccountId: params.account.id,
              campaignId: row.campaignId
            }
          },
          update: {
            customerId: params.account.customerId,
            campaignName: row.campaignName,
            campaignStatus: row.campaignStatus,
            impressions: row.impressions,
            clicks: row.clicks,
            ctrPercent: row.ctrPercent,
            averageCpc: row.averageCpc,
            cost: row.cost,
            conversions: row.conversions,
            costPerConversion: row.costPerConversion,
            conversionValue: row.conversionValue,
            conversionValuePerCost: row.conversionValuePerCost,
            finalUrlSuffix: row.finalUrlSuffix,
            trackingUrlTemplate: row.trackingUrlTemplate,
            utmSource: row.utmSource,
            utmMedium: row.utmMedium,
            utmCampaign: row.utmCampaign,
            utmTerm: row.utmTerm,
            utmContent: row.utmContent,
            sourceRunId: params.runId
          },
          create: {
            factDate: params.runDate,
            adsAccountId: params.account.id,
            customerId: params.account.customerId,
            campaignId: row.campaignId,
            campaignName: row.campaignName,
            campaignStatus: row.campaignStatus,
            impressions: row.impressions,
            clicks: row.clicks,
            ctrPercent: row.ctrPercent,
            averageCpc: row.averageCpc,
            cost: row.cost,
            conversions: row.conversions,
            costPerConversion: row.costPerConversion,
            conversionValue: row.conversionValue,
            conversionValuePerCost: row.conversionValuePerCost,
            finalUrlSuffix: row.finalUrlSuffix,
            trackingUrlTemplate: row.trackingUrlTemplate,
            utmSource: row.utmSource,
            utmMedium: row.utmMedium,
            utmCampaign: row.utmCampaign,
            utmTerm: row.utmTerm,
            utmContent: row.utmContent,
            sourceRunId: params.runId
          }
        });
      }
    });

    await prisma.ingestionAccountRun.update({
      where: {
        id: accountRun.id
      },
      data: {
        status: IngestionAccountRunStatus.SUCCESS,
        rowsUpserted: rows.length,
        finishedAt: new Date(),
        errorSummary: null
      }
    });

    return {
      status: IngestionAccountRunStatus.SUCCESS,
      rowsUpserted: rows.length,
      error: null
    };
  } catch (error) {
    const message = truncate(toErrorMessage(error), 1000);

    await prisma.ingestionAccountRun.update({
      where: {
        id: accountRun.id
      },
      data: {
        status: IngestionAccountRunStatus.FAILED,
        rowsUpserted: 0,
        finishedAt: new Date(),
        errorSummary: message
      }
    });

    return {
      status: IngestionAccountRunStatus.FAILED,
      rowsUpserted: 0,
      error: `[${params.account.customerId}] ${message}`
    };
  }
}

export async function markStaleIngestionRunsAsFailed(): Promise<number> {
  const staleBefore = new Date(Date.now() - env.INGESTION_RUN_STALE_MINUTES * MINUTE_MS);

  const staleRuns = await prisma.ingestionRun.findMany({
    where: {
      status: IngestionRunStatus.RUNNING,
      updatedAt: {
        lt: staleBefore
      }
    },
    select: {
      id: true
    }
  });

  if (staleRuns.length === 0) {
    return 0;
  }

  const ids = staleRuns.map((item) => item.id);
  const now = new Date();
  const message = `Auto-failed stale run (no progress) after ${env.INGESTION_RUN_STALE_MINUTES} minutes.`;

  await prisma.$transaction([
    prisma.ingestionRun.updateMany({
      where: {
        id: {
          in: ids
        },
        status: IngestionRunStatus.RUNNING
      },
      data: {
        status: IngestionRunStatus.FAILED,
        finishedAt: now,
        errorSummary: message
      }
    }),
    prisma.ingestionAccountRun.updateMany({
      where: {
        runId: {
          in: ids
        },
        status: IngestionAccountRunStatus.RUNNING
      },
      data: {
        status: IngestionAccountRunStatus.FAILED,
        finishedAt: now,
        errorSummary: message
      }
    })
  ]);

  return staleRuns.length;
}

export async function preflightGoogleAdsIngestion(params: {
  runDate?: string;
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  takeAccounts?: number;
  batchSize?: number;
  enabledOnly?: boolean;
  skipRunningCheck?: boolean;
  autoFailStaleRuns?: boolean;
}): Promise<IngestionPreflightResult> {
  const runWindow = buildRunWindow({
    runDate: params.runDate,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo
  });

  const requestedAccounts = clampTakeAccounts(params.takeAccounts);
  const batchSize = clampBatchSize(params.batchSize);
  const enabledOnly = params.enabledOnly ?? true;
  const where = buildEligibleAccountsWhere({
    accountId: params.accountId,
    enabledOnly
  });

  const staleRunsAutoFailed = params.autoFailStaleRuns ? await markStaleIngestionRunsAsFailed() : 0;

  const [connection, runningRun, totalEligible] = await Promise.all([
    prisma.googleOAuthConnection.findUnique({
      where: {
        id: 'GOOGLE'
      },
      select: {
        status: true,
        encryptedRefreshToken: true,
        grantedEmail: true,
        managerCustomerId: true,
        refreshTokenExpiresAt: true
      }
    }),
    prisma.ingestionRun.findFirst({
      where: {
        status: IngestionRunStatus.RUNNING
      },
      orderBy: {
        startedAt: 'asc'
      },
      select: {
        id: true,
        runDate: true,
        startedAt: true
      }
    }),
    prisma.adsAccount.count({ where })
  ]);

  const selectedAccounts = Math.min(totalEligible, requestedAccounts);

  const configured = Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN && env.GOOGLE_ADS_MANAGER_CUSTOMER_ID);
  const connected = Boolean(
    connection && connection.status === OAuthConnectionStatus.ACTIVE && connection.encryptedRefreshToken
  );

  const tokenDaysLeft =
    connection?.refreshTokenExpiresAt === null || connection?.refreshTokenExpiresAt === undefined
      ? null
      : Math.ceil((connection.refreshTokenExpiresAt.getTime() - Date.now()) / DAY_MS);

  const tokenExpired = tokenDaysLeft !== null && tokenDaysLeft < 0;
  const ready = configured && connected && !tokenExpired;

  const runningConflict =
    runningRun === null
      ? null
      : {
          id: runningRun.id,
          runDate: toDateOnlyString(runningRun.runDate),
          startedAt: runningRun.startedAt.toISOString(),
          ageMinutes: Math.max(0, Math.floor((Date.now() - runningRun.startedAt.getTime()) / MINUTE_MS))
        };

  let reason: string | null = null;

  if (!ready) {
    reason = 'Google OAuth/Google Ads connection is not ready.';
  } else if (runningConflict && !params.skipRunningCheck) {
    reason = `Ingestion run ${runningConflict.id} is still RUNNING.`;
  } else if (selectedAccounts === 0) {
    reason = 'No eligible Google Ads accounts found for ingestion.';
  }

  return {
    runWindow,
    canRun: reason === null,
    reason,
    staleRunsAutoFailed,
    oauth: {
      configured,
      connected,
      ready,
      managerCustomerId: connection?.managerCustomerId ?? null,
      grantedEmail: connection?.grantedEmail ?? null,
      refreshTokenExpiresAt: connection?.refreshTokenExpiresAt?.toISOString() ?? null,
      tokenDaysLeft
    },
    limits: {
      requestedAccounts,
      selectedAccounts,
      batchSize,
      maxRangeDays: env.INGESTION_MAX_RANGE_DAYS,
      enabledOnly
    },
    runningRun: runningConflict
  };
}

export async function runGoogleAdsIngestion(params: RunGoogleAdsIngestionParams = {}) {
  const preflight = await preflightGoogleAdsIngestion({
    runDate: params.runDate,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    accountId: params.accountId,
    takeAccounts: params.takeAccounts,
    batchSize: params.batchSize,
    enabledOnly: params.enabledOnly,
    autoFailStaleRuns: true
  });

  if (!preflight.canRun) {
    throw new ApiError(409, preflight.reason ?? 'Ingestion cannot be started.', preflight);
  }

  const runWindow = preflight.runWindow;
  const where = buildEligibleAccountsWhere({
    accountId: params.accountId,
    enabledOnly: preflight.limits.enabledOnly
  });
  const runDate = parseDateOnlyToUtcDayStart(runWindow.runDate);
  const dateFrom = parseDateOnlyToUtcDayStart(runWindow.dateFrom);
  const dateTo = parseDateOnlyToUtcDayStart(runWindow.dateTo);

  const startup = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${INGESTION_START_LOCK_KEY}::bigint) AS locked
    `;

    if (!lockRows[0]?.locked) {
      throw new ApiError(409, 'Another ingestion start is in progress. Retry in a few seconds.');
    }

    const runningRun = await tx.ingestionRun.findFirst({
      where: {
        status: IngestionRunStatus.RUNNING
      },
      orderBy: {
        startedAt: 'asc'
      },
      select: {
        id: true
      }
    });

    if (runningRun) {
      throw new ApiError(409, `Ingestion run ${runningRun.id} is still RUNNING.`, preflight);
    }

    const accounts = await tx.adsAccount.findMany({
      where,
      take: preflight.limits.selectedAccounts,
      orderBy: {
        id: 'asc'
      },
      select: {
        id: true,
        customerId: true,
        descriptiveName: true
      }
    });

    if (accounts.length === 0) {
      throw new ApiError(404, 'No eligible Google Ads accounts found for ingestion.');
    }

    const createdRun = await tx.ingestionRun.create({
      data: {
        runDate,
        dateFrom,
        dateTo,
        status: IngestionRunStatus.RUNNING,
        triggerSource: params.triggerSource ?? TriggerSource.MANUAL,
        totalAccounts: accounts.length
      },
      select: {
        id: true
      }
    });

    return {
      accounts,
      createdRun
    };
  });

  const runDates = getRunDates(runWindow);
  const accounts = startup.accounts as IngestionEligibleAccount[];
  const createdRun = startup.createdRun;

  let processedAccounts = 0;
  let successAccounts = 0;
  let failedAccounts = 0;
  let skippedAccounts = 0;
  let rowsUpserted = 0;
  let heartbeatTick = 0;
  const errors: string[] = [];
  const persistProgress = async () => {
    await prisma.ingestionRun.update({
      where: {
        id: createdRun.id
      },
      data: {
        processedAccounts,
        successAccounts,
        failedAccounts,
        skippedAccounts,
        rowsUpserted,
        errorSummary:
          errors.length === 0
            ? null
            : truncate(
                errors.slice(-3).join(' | '),
                1500
              )
      }
    });
  };

  try {
    const credentials = await getGoogleAdsRuntimeCredentials();

    for (const account of accounts as IngestionEligibleAccount[]) {
      let accountHadSuccess = false;
      let accountHadFailure = false;
      const accountErrors: string[] = [];

      for (const day of runDates) {
        const dayText = toDateOnlyString(day);
        const result = await processAccountForDate({
          runId: createdRun.id,
          runDate: day,
          runDateText: dayText,
          account,
          credentials
        });

        rowsUpserted += result.rowsUpserted;

        if (result.status === IngestionAccountRunStatus.SUCCESS) {
          accountHadSuccess = true;
        } else if (result.status === IngestionAccountRunStatus.FAILED) {
          accountHadFailure = true;
          if (result.error) {
            accountErrors.push(`${dayText}: ${result.error}`);
          }
        } else {
          // SKIPPED means no rows for this account on this specific day.
        }

        heartbeatTick += 1;
        if (heartbeatTick % 10 === 0) {
          await persistProgress();
        }
      }

      processedAccounts += 1;

      if (accountHadFailure) {
        failedAccounts += 1;
        if (accountErrors.length > 0) {
          errors.push(accountErrors[0]);
        }
      } else if (accountHadSuccess) {
        successAccounts += 1;
      } else {
        skippedAccounts += 1;
      }

      await persistProgress();
    }

    const status = deriveRunStatus({
      processedAccounts,
      failedAccounts
    });

    const run = await prisma.ingestionRun.update({
      where: {
        id: createdRun.id
      },
      data: {
        status,
        finishedAt: new Date(),
        processedAccounts,
        successAccounts,
        failedAccounts,
        skippedAccounts,
        rowsUpserted,
        errorSummary:
          errors.length === 0
            ? null
            : truncate(
                errors.slice(0, 3).join(' | '),
                1500
              )
      }
    });

    return {
      run,
      preflight,
      errors
    };
  } catch (error) {
    const reason = truncate(toErrorMessage(error), 1500);

    await prisma.ingestionRun.update({
      where: {
        id: createdRun.id
      },
      data: {
        status: IngestionRunStatus.FAILED,
        finishedAt: new Date(),
        processedAccounts,
        successAccounts,
        failedAccounts,
        skippedAccounts,
        rowsUpserted,
        errorSummary: reason
      }
    });

    throw new ApiError(502, 'Ingestion run failed.', {
      runId: createdRun.id,
      reason
    });
  }
}

export async function listGoogleAdsIngestionRuns(filters: {
  status?: IngestionRunStatus;
  triggerSource?: TriggerSource;
  runDate?: string;
  take?: number;
}) {
  const take = Math.min(Math.max(filters.take ?? 20, 1), 100);

  const where: Prisma.IngestionRunWhereInput = {
    status: filters.status,
    triggerSource: filters.triggerSource
  };

  if (filters.runDate) {
    const runDate = parseDateOnlyToUtcDayStart(filters.runDate);
    const window = getUtcDayWindow(runDate);

    where.runDate = {
      gte: window.start,
      lt: window.end
    };
  }

  const items = await prisma.ingestionRun.findMany({
    where,
    take,
    orderBy: {
      startedAt: 'desc'
    }
  });

  return { items };
}

export async function getGoogleAdsIngestionRunById(runId: string) {
  const run = await prisma.ingestionRun.findUnique({
    where: {
      id: runId
    },
    include: {
      accountRuns: {
        include: {
          adsAccount: {
            select: {
              id: true,
              customerId: true,
              descriptiveName: true
            }
          }
        },
        orderBy: [{ runDate: 'desc' }, { createdAt: 'desc' }]
      }
    }
  });

  if (!run) {
    throw new ApiError(404, 'Ingestion run not found.');
  }

  return run;
}

export async function listCampaignDailyFacts(filters: {
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  take?: number;
}) {
  const take = Math.min(Math.max(filters.take ?? 100, 1), 2000);

  const where: Prisma.CampaignDailyFactWhereInput = {
    adsAccountId: filters.accountId
  };

  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? parseDateOnlyToUtcDayStart(filters.dateFrom) : null;
    const to = filters.dateTo ? parseDateOnlyToUtcDayStart(filters.dateTo) : null;

    where.factDate = {
      gte: from ?? undefined,
      lt: to ? new Date(to.getTime() + DAY_MS) : undefined
    };
  }

  const items = await prisma.campaignDailyFact.findMany({
    where,
    take,
    orderBy: [{ factDate: 'desc' }, { cost: 'desc' }],
    include: {
      adsAccount: {
        select: {
          id: true,
          customerId: true,
          descriptiveName: true
        }
      }
    }
  });

  return { items };
}

function summarizeStatuses(statuses: IngestionRunStatus[]) {
  const counts = {
    total: statuses.length,
    running: 0,
    success: 0,
    partial: 0,
    failed: 0,
    cancelled: 0
  };

  for (const status of statuses) {
    if (status === IngestionRunStatus.RUNNING) {
      counts.running += 1;
      continue;
    }

    if (status === IngestionRunStatus.SUCCESS) {
      counts.success += 1;
      continue;
    }

    if (status === IngestionRunStatus.PARTIAL) {
      counts.partial += 1;
      continue;
    }

    if (status === IngestionRunStatus.CANCELLED) {
      counts.cancelled += 1;
      continue;
    }

    counts.failed += 1;
  }

  const finishedTotal = counts.success + counts.partial + counts.failed + counts.cancelled;
  const successLike = counts.success + counts.partial;

  return {
    ...counts,
    finishedTotal,
    successRatePercent: finishedTotal > 0 ? roundTo((successLike / finishedTotal) * 100, 2) : null
  };
}

export async function getGoogleAdsIngestionHealth() {
  const now = new Date();
  const last24h = new Date(now.getTime() - DAY_MS);

  const [runningCount, lastRun, runsLast24h, rowsLast24h, eligibleAccounts, accountsWithFactsYesterday] =
    await Promise.all([
      prisma.ingestionRun.count({
        where: {
          status: IngestionRunStatus.RUNNING
        }
      }),
      prisma.ingestionRun.findFirst({
        orderBy: {
          startedAt: 'desc'
        }
      }),
      prisma.ingestionRun.findMany({
        where: {
          startedAt: {
            gte: last24h
          }
        },
        select: {
          status: true
        }
      }),
      prisma.ingestionRun.aggregate({
        where: {
          startedAt: {
            gte: last24h
          }
        },
        _sum: {
          rowsUpserted: true
        }
      }),
      prisma.adsAccount.count({
        where: buildEligibleAccountsWhere({
          enabledOnly: true
        })
      }),
      prisma.campaignDailyFact.groupBy({
        by: ['adsAccountId'],
        where: {
          factDate: {
            gte: getDefaultYesterdayRunDate(now, 'Europe/Kyiv'),
            lt: new Date(getDefaultYesterdayRunDate(now, 'Europe/Kyiv').getTime() + DAY_MS)
          }
        }
      }).then((items) => items.length)
    ]);

  return {
    runs: {
      runningCount,
      lastRun,
      last24h: summarizeStatuses(runsLast24h.map((item) => item.status))
    },
    accounts: {
      eligible: eligibleAccounts,
      withFactsForYesterday: accountsWithFactsYesterday,
      missingFactsForYesterday: Math.max(eligibleAccounts - accountsWithFactsYesterday, 0)
    },
    throughput: {
      rowsUpserted24h: rowsLast24h._sum.rowsUpserted ?? 0
    }
  };
}
