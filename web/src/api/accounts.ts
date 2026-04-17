import { get, patch, post, qs } from './client.js';

export type AdsAccount = {
  id: string;
  customerId: string;
  descriptiveName: string;
  currencyCode: string | null;
  timeZone: string | null;
  googleStatus: string | null;
  isManager: boolean;
  isInMcc: boolean;
  ingestionEnabled: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSyncedAt: string;
};

export type GoogleStatus = {
  oauth: {
    configured: boolean;
    connected: boolean;
    status: string;
    grantedEmail: string | null;
    scopes: string[];
    managerCustomerId: string | null;
    refreshTokenExpiresAt: string | null;
    tokenWarning: {
      shouldWarn: boolean;
      daysLeft: number | null;
    };
  };
  accounts: {
    total: number;
    inMcc: number;
    enabledForIngestion: number;
    activeConfigs: number;
  };
  lastSync: { startedAt: string; status: string } | null;
};

export const accountsApi = {
  getStatus: () => get<GoogleStatus>('/google/status'),

  syncAccounts: () => post<{ discovered: number; updated: number; total: number }>('/google/accounts/sync'),

  list: (filters?: { q?: string; isInMcc?: boolean; ingestionEnabled?: boolean; take?: number }) =>
    get<{ items: AdsAccount[] }>(`/google/accounts${qs(filters ?? {})}`),

  patch: (accountId: string, data: { ingestionEnabled?: boolean }) =>
    patch<AdsAccount>(`/google/accounts/${accountId}`, data),
};
