import { get, post, qs } from './client.js';

export type IngestionRun = {
  id: string;
  runDate: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  triggerSource: string;
  totalAccounts: number;
  processedAccounts: number;
  successAccounts: number;
  failedAccounts: number;
  skippedAccounts: number;
  rowsUpserted: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type IngestionAccountRun = {
  id: string;
  adsAccountId: string;
  runDate: string;
  status: string;
  rowsUpserted: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
  adsAccount: { id: string; customerId: string; descriptiveName: string };
};

export type CampaignDailyFact = {
  id: string;
  factDate: string;
  adsAccountId: string;
  customerId: string;
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
  adsAccount: { id: string; customerId: string; descriptiveName: string };
};

export type IngestionPreflightResult = {
  runWindow: { runDate: string; dateFrom: string; dateTo: string; totalDays: number };
  canRun: boolean;
  reason: string | null;
  oauth: { connected: boolean; ready: boolean; grantedEmail: string | null; managerCustomerId: string | null };
  limits: { selectedAccounts: number; maxRangeDays: number };
  runningRun: { id: string; startedAt: string; ageMinutes: number } | null;
};

export type CoverageItem = {
  accountId: string;
  customerId: string;
  descriptiveName: string;
  lastFactDate: string | null;
  hasDataForYesterday: boolean;
  staleDays: number | null;
};

export type ActiveIngestionRun = IngestionRun & {
  accountRuns: (IngestionAccountRun & { adsAccount: { customerId: string; descriptiveName: string } })[];
};

export const ingestionApi = {
  preflight: (params: { runDate?: string; dateFrom?: string; dateTo?: string; accountId?: string; includeInactiveAccounts?: boolean }) =>
    get<IngestionPreflightResult>(`/ingestion/preflight${qs(params)}`),

  run: (params: {
    runDate?: string;
    dateFrom?: string;
    dateTo?: string;
    accountId?: string;
    campaignId?: string;
    enabledOnly?: boolean;
    includeInactiveAccounts?: boolean;
  }) => post<IngestionRun>('/ingestion/runs', params),

  listRuns: (filters?: { status?: string; take?: number }) =>
    get<{ items: IngestionRun[] }>(`/ingestion/runs${qs(filters ?? {})}`),

  getRunById: (runId: string) =>
    get<IngestionRun & { accountRuns: IngestionAccountRun[] }>(`/ingestion/runs/${runId}`),

  getActiveRun: () => get<ActiveIngestionRun | null>('/ingestion/runs/active'),

  getCoverage: () => get<{ items: CoverageItem[]; yesterdayDate: string }>('/ingestion/coverage'),

  preview: (filters: { accountId?: string; campaignId?: string; dateFrom?: string; dateTo?: string; take?: number }) =>
    get<{ items: CampaignDailyFact[]; total: number; showing: number }>(`/ingestion/preview${qs(filters)}`),

  getHealth: () => get<{
    runs: { runningCount: number; lastRun: IngestionRun | null; last24h: Record<string, number> };
    accounts: { eligible: number; withFactsForYesterday: number; missingFactsForYesterday: number };
    throughput: { rowsUpserted24h: number };
  }>('/ingestion/health'),
};
