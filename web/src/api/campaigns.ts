import { get, post, qs } from './client.js';

export type Campaign = {
  id: string;
  adsAccountId: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  advertisingChannel: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  adsAccount: {
    id: string;
    customerId: string;
    descriptiveName: string;
  };
};

export type CampaignSyncRun = {
  id: string;
  adsAccountId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  totalSeen: number;
  discoveredCount: number;
  updatedCount: number;
  errorSummary: string | null;
  adsAccount: {
    id: string;
    customerId: string;
    descriptiveName: string;
  };
};

export const campaignsApi = {
  sync: (accountId?: string) =>
    post<{ totalSeen?: number; discoveredCount?: number; updatedCount?: number; status?: string; total?: number; succeeded?: number; failed?: number }>(
      '/campaigns/sync',
      accountId ? { accountId } : {},
    ),

  list: (filters?: { accountId?: string; status?: string; q?: string; take?: number }) =>
    get<{ items: Campaign[]; total: number }>(`/campaigns${qs(filters ?? {})}`),

  listSyncRuns: (filters?: { accountId?: string; take?: number }) =>
    get<{ items: CampaignSyncRun[] }>(`/campaigns/sync-runs${qs(filters ?? {})}`),
};
