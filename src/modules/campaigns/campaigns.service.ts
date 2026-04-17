import axios from 'axios';
import { SyncRunStatus } from '@prisma/client';
import { env } from '../../config/env.js';
import { ApiError } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { getGoogleAdsRuntimeCredentials } from '../google/google.service.js';

type CampaignApiRow = {
  campaign?: {
    id?: string | number;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
    advertising_channel_type?: string;
  };
  campaign_?: {
    id?: string | number;
    name?: string;
    status?: string;
    advertising_channel_type?: string;
  };
};

type CampaignApiBatch = {
  results?: CampaignApiRow[];
};

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

function parseCampaignApiRows(payload: unknown): Array<{
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  advertisingChannel: string | null;
}> {
  if (!Array.isArray(payload)) return [];

  const rows: Array<{
    campaignId: string;
    campaignName: string;
    campaignStatus: string;
    advertisingChannel: string | null;
  }> = [];

  for (const batch of payload as CampaignApiBatch[]) {
    const items = Array.isArray(batch.results) ? batch.results : [];
    for (const item of items) {
      const campaign = item.campaign ?? item.campaign_;
      if (!campaign) continue;

      const campaignId = normalizeCampaignId(campaign.id);
      if (!campaignId) continue;

      const channelRaw =
        (item.campaign?.advertisingChannelType ?? item.campaign?.advertising_channel_type ?? campaign.advertising_channel_type) ?? null;
      const advertisingChannel =
        typeof channelRaw === 'string' && channelRaw.trim().length > 0 && channelRaw !== 'UNSPECIFIED'
          ? channelRaw.trim()
          : null;

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
        advertisingChannel
      });
    }
  }

  return rows;
}

async function fetchAllCampaignsForCustomer(params: {
  accessToken: string;
  developerToken: string;
  managerCustomerId: string;
  customerId: string;
}): Promise<ReturnType<typeof parseCampaignApiRows>> {
  const endpoint = `https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}/customers/${params.customerId}/googleAds:searchStream`;

  const query = `SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type
FROM campaign
ORDER BY campaign.name`;

  const response = await axios.post<CampaignApiBatch[]>(
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
  );

  return parseCampaignApiRows(response.data);
}

export async function syncCampaignsForAccount(adsAccountId: string): Promise<{
  syncRunId: string;
  totalSeen: number;
  discoveredCount: number;
  updatedCount: number;
  status: SyncRunStatus;
  errorSummary: string | null;
}> {
  const account = await prisma.adsAccount.findUnique({
    where: { id: adsAccountId },
    select: { id: true, customerId: true, descriptiveName: true }
  });

  if (!account) {
    throw new ApiError(404, 'Account not found.');
  }

  const syncRun = await prisma.campaignSyncRun.create({
    data: { adsAccountId, status: SyncRunStatus.RUNNING }
  });

  try {
    const credentials = await getGoogleAdsRuntimeCredentials();
    const apiRows = await fetchAllCampaignsForCustomer({
      accessToken: credentials.accessToken,
      developerToken: credentials.developerToken,
      managerCustomerId: credentials.managerCustomerId,
      customerId: account.customerId
    });

    const now = new Date();
    let discoveredCount = 0;
    let updatedCount = 0;

    for (const row of apiRows) {
      const existing = await prisma.campaign.findUnique({
        where: {
          adsAccountId_campaignId: {
            adsAccountId: account.id,
            campaignId: row.campaignId
          }
        },
        select: { id: true, campaignName: true, campaignStatus: true, advertisingChannel: true }
      });

      if (!existing) {
        await prisma.campaign.create({
          data: {
            adsAccountId: account.id,
            campaignId: row.campaignId,
            campaignName: row.campaignName,
            campaignStatus: row.campaignStatus,
            advertisingChannel: row.advertisingChannel,
            firstSeenAt: now,
            lastSeenAt: now
          }
        });
        discoveredCount += 1;
      } else {
        const changed =
          existing.campaignName !== row.campaignName ||
          existing.campaignStatus !== row.campaignStatus ||
          existing.advertisingChannel !== row.advertisingChannel;

        await prisma.campaign.update({
          where: {
            adsAccountId_campaignId: {
              adsAccountId: account.id,
              campaignId: row.campaignId
            }
          },
          data: {
            campaignName: row.campaignName,
            campaignStatus: row.campaignStatus,
            advertisingChannel: row.advertisingChannel,
            lastSeenAt: now,
            ...(changed ? { updatedAt: now } : {})
          }
        });
        if (changed) updatedCount += 1;
      }
    }

    const updated = await prisma.campaignSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: SyncRunStatus.SUCCESS,
        finishedAt: now,
        totalSeen: apiRows.length,
        discoveredCount,
        updatedCount
      }
    });

    return {
      syncRunId: updated.id,
      totalSeen: apiRows.length,
      discoveredCount,
      updatedCount,
      status: SyncRunStatus.SUCCESS,
      errorSummary: null
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    const errorSummary = message.length > 1000 ? message.slice(0, 997) + '...' : message;

    await prisma.campaignSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: SyncRunStatus.FAILED,
        finishedAt: new Date(),
        errorSummary
      }
    });

    return {
      syncRunId: syncRun.id,
      totalSeen: 0,
      discoveredCount: 0,
      updatedCount: 0,
      status: SyncRunStatus.FAILED,
      errorSummary
    };
  }
}

export async function syncCampaignsForAllAccounts(): Promise<{
  total: number;
  succeeded: number;
  failed: number;
}> {
  const accounts = await prisma.adsAccount.findMany({
    where: { isInMcc: true, isManager: false, ingestionEnabled: true },
    select: { id: true },
    orderBy: { descriptiveName: 'asc' }
  });

  let succeeded = 0;
  let failed = 0;

  for (const account of accounts) {
    const result = await syncCampaignsForAccount(account.id);
    if (result.status === SyncRunStatus.SUCCESS) {
      succeeded += 1;
    } else {
      failed += 1;
    }
  }

  return { total: accounts.length, succeeded, failed };
}

export async function listCampaigns(filters: {
  accountId?: string;
  status?: string;
  q?: string;
  take?: number;
}) {
  const take = Math.min(Math.max(filters.take ?? 500, 1), 5000);

  const items = await prisma.campaign.findMany({
    where: {
      adsAccountId: filters.accountId,
      ...(filters.status ? { campaignStatus: filters.status } : {}),
      ...(filters.q
        ? { campaignName: { contains: filters.q, mode: 'insensitive' } }
        : {})
    },
    take,
    orderBy: [{ campaignStatus: 'asc' }, { campaignName: 'asc' }],
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

  return { items, total: items.length };
}

export async function listCampaignSyncRuns(filters: {
  accountId?: string;
  take?: number;
}) {
  const take = Math.min(Math.max(filters.take ?? 50, 1), 200);

  const items = await prisma.campaignSyncRun.findMany({
    where: { adsAccountId: filters.accountId },
    take,
    orderBy: { startedAt: 'desc' },
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
