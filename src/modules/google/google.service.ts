import axios from 'axios';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import {
  OAuthConnectionStatus,
  SyncRunStatus,
  type Prisma
} from '@prisma/client';
import { env } from '../../config/env.js';
import { ApiError } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { assertAllowedGoogleLoginEmail } from '../auth/auth.service.js';

type GoogleAccountSnapshot = {
  customerId: string;
  descriptiveName: string;
  currencyCode: string | null;
  timeZone: string | null;
  googleStatus: string | null;
  isManager: boolean;
  hierarchyLevel: number | null;
};

type GoogleAdsSearchStreamResult = {
  customerClient?: {
    id?: string | number;
    clientCustomer?: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    status?: string;
    manager?: boolean;
    level?: number | string;
  };
  customer_client?: {
    id?: string | number;
    client_customer?: string;
    descriptive_name?: string;
    currency_code?: string;
    time_zone?: string;
    status?: string;
    manager?: boolean;
    level?: number | string;
  };
};

type GoogleAdsSearchStreamBatch = {
  results?: GoogleAdsSearchStreamResult[];
};

type GoogleUserInfoResponse = {
  email?: string;
};

export type GoogleRuntimeToken = {
  connectionId: string;
  accessToken: string;
  scopes: string[];
  grantedEmail: string | null;
  refreshTokenExpiresAt: Date | null;
  status: OAuthConnectionStatus;
};

export type GoogleAdsRuntimeCredentials = {
  connectionId: string;
  managerCustomerId: string;
  developerToken: string;
  accessToken: string;
};

type AccountFilters = {
  q?: string;
  isInMcc?: boolean;
  ingestionEnabled?: boolean;
  take?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function splitCsv(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function joinCsv(values: string[]): string {
  return values.join(' ');
}

function normalizeRedirectPath(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return '/';
  }

  if (/[\r\n]/.test(normalized)) {
    return '/';
  }

  return normalized;
}

function getGoogleOAuthScopes(): string[] {
  const scopes = splitCsv(env.GOOGLE_OAUTH_SCOPES);

  if (scopes.length > 0) {
    return scopes;
  }

  return [
    'https://www.googleapis.com/auth/adwords',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
  ];
}

function normalizeCustomerId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/\D/g, '');
  return normalized.length > 0 ? normalized : null;
}

function parseHierarchyLevel(value: number | string | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function assertGoogleOAuthConfig(): void {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new ApiError(
      400,
      'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI.'
    );
  }
}

function assertGoogleAdsConfig(): { managerCustomerId: string; developerToken: string } {
  const managerCustomerId = normalizeCustomerId(env.GOOGLE_ADS_MANAGER_CUSTOMER_ID);
  if (!managerCustomerId) {
    throw new ApiError(400, 'GOOGLE_ADS_MANAGER_CUSTOMER_ID is not configured.');
  }

  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new ApiError(400, 'GOOGLE_ADS_DEVELOPER_TOKEN is not configured.');
  }

  return {
    managerCustomerId,
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN
  };
}

function buildOAuthClient(): OAuth2Client {
  assertGoogleOAuthConfig();
  return new OAuth2Client(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET, env.GOOGLE_OAUTH_REDIRECT_URI);
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashRaw(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getEncryptionKey(): Buffer {
  const source = env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY?.trim() || env.GOOGLE_OAUTH_CLIENT_SECRET || 'change_me';
  return crypto.createHash('sha256').update(source).digest();
}

function encryptSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptSecret(secret: string): string {
  const key = getEncryptionKey();
  const parts = secret.split('.');
  if (parts.length !== 3) {
    throw new ApiError(500, 'Stored OAuth token has invalid format.');
  }

  const [ivEncoded, tagEncoded, dataEncoded] = parts;
  const iv = Buffer.from(ivEncoded, 'base64url');
  const tag = Buffer.from(tagEncoded, 'base64url');
  const data = Buffer.from(dataEncoded, 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

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

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  return [429, 500, 502, 503, 504].includes(error.response.status);
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

function deriveRefreshTokenExpiry(tokens: OAuth2Client['credentials']): Date | null {
  const raw = (tokens as { refresh_token_expires_in?: number }).refresh_token_expires_in;
  if (typeof raw !== 'number' || Number.isNaN(raw) || raw <= 0) {
    return null;
  }

  return new Date(Date.now() + raw * 1000);
}

function parseGoogleAdsAccounts(payload: unknown): GoogleAccountSnapshot[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const byId = new Map<string, GoogleAccountSnapshot>();

  for (const batch of payload as GoogleAdsSearchStreamBatch[]) {
    const rows = Array.isArray(batch.results) ? batch.results : [];

    for (const row of rows) {
      const item =
        row.customerClient ??
        (row.customer_client
          ? {
              id: row.customer_client.id,
              clientCustomer: row.customer_client.client_customer,
              descriptiveName: row.customer_client.descriptive_name,
              currencyCode: row.customer_client.currency_code,
              timeZone: row.customer_client.time_zone,
              status: row.customer_client.status,
              manager: row.customer_client.manager,
              level: row.customer_client.level
            }
          : undefined);

      if (!item) {
        continue;
      }

      const normalizedId = normalizeCustomerId(item.id?.toString() || item.clientCustomer || null);
      if (!normalizedId) {
        continue;
      }

      byId.set(normalizedId, {
        customerId: normalizedId,
        descriptiveName: item.descriptiveName?.trim() || `Customer ${normalizedId}`,
        currencyCode: item.currencyCode?.trim() || null,
        timeZone: item.timeZone?.trim() || null,
        googleStatus: item.status?.toString() || null,
        isManager: Boolean(item.manager),
        hierarchyLevel: parseHierarchyLevel(item.level)
      });
    }
  }

  return Array.from(byId.values());
}

async function ensureConnection(): Promise<void> {
  await prisma.googleOAuthConnection.upsert({
    where: { id: 'GOOGLE' },
    create: {
      id: 'GOOGLE',
      status: OAuthConnectionStatus.DISCONNECTED,
      clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? null,
      managerCustomerId: normalizeCustomerId(env.GOOGLE_ADS_MANAGER_CUSTOMER_ID),
      scopesCsv: joinCsv(getGoogleOAuthScopes())
    },
    update: {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? undefined,
      managerCustomerId: normalizeCustomerId(env.GOOGLE_ADS_MANAGER_CUSTOMER_ID) ?? undefined,
      scopesCsv: joinCsv(getGoogleOAuthScopes())
    }
  });
}

async function getConnectionOrThrow() {
  await ensureConnection();

  const connection = await prisma.googleOAuthConnection.findUnique({
    where: { id: 'GOOGLE' }
  });

  if (!connection) {
    throw new ApiError(500, 'Google OAuth connection record is missing.');
  }

  return connection;
}

async function fetchGrantedEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await withRetries(() =>
      axios.get<GoogleUserInfoResponse>('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        timeout: env.GOOGLE_ADS_HTTP_TIMEOUT_MS
      })
    );

    return typeof response.data.email === 'string' ? response.data.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function getGoogleAccessToken(connectionId: string): Promise<string> {
  const connection = await prisma.googleOAuthConnection.findUnique({ where: { id: connectionId } });

  if (!connection || !connection.encryptedRefreshToken) {
    throw new ApiError(400, 'Google OAuth is not connected.');
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(connection.encryptedRefreshToken);
  } catch {
    throw new ApiError(500, 'Failed to decrypt stored Google refresh token.');
  }

  try {
    const oauth = buildOAuthClient();
    oauth.setCredentials({ refresh_token: refreshToken });

    const tokenResponse = await oauth.getAccessToken();
    const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token ?? null;

    if (!accessToken) {
      throw new ApiError(401, 'Failed to refresh Google access token.');
    }

    await prisma.googleOAuthConnection.update({
      where: { id: connection.id },
      data: {
        status: OAuthConnectionStatus.ACTIVE,
        lastTokenRefreshAt: new Date()
      }
    });

    return accessToken;
  } catch (error) {
    await prisma.googleOAuthConnection.update({
      where: { id: connection.id },
      data: {
        status: OAuthConnectionStatus.NEEDS_REAUTH
      }
    });

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(401, 'Google token refresh failed. Reconnect OAuth.', { reason: toErrorMessage(error) });
  }
}

async function fetchManagedAccountsFromMcc(params: {
  accessToken: string;
  managerCustomerId: string;
  developerToken: string;
}): Promise<GoogleAccountSnapshot[]> {
  const endpoint = `https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}/customers/${params.managerCustomerId}/googleAds:searchStream`;

  const query = `SELECT
  customer_client.client_customer,
  customer_client.id,
  customer_client.descriptive_name,
  customer_client.currency_code,
  customer_client.time_zone,
  customer_client.status,
  customer_client.manager,
  customer_client.level
FROM customer_client`;

  const response = await withRetries(() =>
    axios.post<GoogleAdsSearchStreamBatch[]>(
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

  return parseGoogleAdsAccounts(response.data);
}

async function applyMccSnapshot(params: {
  connectionId: string;
  items: GoogleAccountSnapshot[];
}): Promise<{
  totalSeen: number;
  discoveredCount: number;
  reappearedCount: number;
  detachedCount: number;
}> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.adsAccount.findMany({
      where: { connectionId: params.connectionId },
      select: {
        id: true,
        customerId: true,
        isInMcc: true
      }
    });

    const byCustomerId = new Map(existing.map((item) => [item.customerId, item]));
    const seen = new Set<string>();

    let discoveredCount = 0;
    let reappearedCount = 0;

    for (const item of params.items) {
      seen.add(item.customerId);
      const current = byCustomerId.get(item.customerId);

      if (!current) {
        await tx.adsAccount.create({
          data: {
            connectionId: params.connectionId,
            customerId: item.customerId,
            descriptiveName: item.descriptiveName,
            currencyCode: item.currencyCode,
            timeZone: item.timeZone,
            googleStatus: item.googleStatus,
            isManager: item.isManager,
            hierarchyLevel: item.hierarchyLevel,
            isInMcc: true,
            firstSeenAt: now,
            lastSeenAt: now,
            lastSyncedAt: now,
            ingestionEnabled: !item.isManager
          }
        });

        discoveredCount += 1;
        continue;
      }

      if (!current.isInMcc) {
        reappearedCount += 1;
      }

      await tx.adsAccount.update({
        where: { id: current.id },
        data: {
          descriptiveName: item.descriptiveName,
          currencyCode: item.currencyCode,
          timeZone: item.timeZone,
          googleStatus: item.googleStatus,
          isManager: item.isManager,
          hierarchyLevel: item.hierarchyLevel,
          isInMcc: true,
          lastSeenAt: now,
          lastSyncedAt: now
        }
      });
    }

    const detached = existing.filter((item) => item.isInMcc && !seen.has(item.customerId));

    if (detached.length > 0) {
      await tx.adsAccount.updateMany({
        where: {
          id: {
            in: detached.map((item) => item.id)
          }
        },
        data: {
          isInMcc: false,
          lastSyncedAt: now
        }
      });
    }

    return {
      totalSeen: params.items.length,
      discoveredCount,
      reappearedCount,
      detachedCount: detached.length
    };
  });
}

function buildAccountWhere(filters: AccountFilters): Prisma.AdsAccountWhereInput {
  const where: Prisma.AdsAccountWhereInput = {};

  if (typeof filters.isInMcc === 'boolean') {
    where.isInMcc = filters.isInMcc;
  }

  if (typeof filters.ingestionEnabled === 'boolean') {
    where.ingestionEnabled = filters.ingestionEnabled;
  }

  if (filters.q && filters.q.trim().length > 0) {
    const query = filters.q.trim();
    where.OR = [
      {
        customerId: {
          contains: query
        }
      },
      {
        descriptiveName: {
          contains: query
        }
      }
    ];
  }

  return where;
}

export async function getGoogleIntegrationStatus() {
  const connection = await prisma.googleOAuthConnection.findUnique({
    where: { id: 'GOOGLE' }
  });

  if (!connection) {
    return {
      oauth: {
        configured: Boolean(
          env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI
        ),
        connected: false,
        status: OAuthConnectionStatus.DISCONNECTED,
        grantedEmail: null,
        scopes: getGoogleOAuthScopes(),
        managerCustomerId: normalizeCustomerId(env.GOOGLE_ADS_MANAGER_CUSTOMER_ID),
        refreshTokenExpiresAt: null,
        tokenWarning: {
          shouldWarn: false,
          daysLeft: null
        }
      },
      accounts: {
        total: 0,
        inMcc: 0,
        enabledForIngestion: 0,
        activeConfigs: 0
      },
      lastSync: null
    };
  }

  const tokenDaysLeft =
    connection.refreshTokenExpiresAt === null
      ? null
      : Math.ceil((connection.refreshTokenExpiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  const [total, inMcc, enabledForIngestion, activeConfigs, lastSync] = await Promise.all([
    prisma.adsAccount.count(),
    prisma.adsAccount.count({ where: { isInMcc: true } }),
    prisma.adsAccount.count({
      where: {
        isInMcc: true,
        isManager: false,
        ingestionEnabled: true,
        NOT: {
          googleStatus: 'CLOSED'
        }
      }
    }),
    prisma.accountSheetConfig.count({ where: { active: true } }),
    prisma.googleAdsSyncRun.findFirst({
      orderBy: {
        startedAt: 'desc'
      }
    })
  ]);

  return {
    oauth: {
      configured: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI),
      connected: Boolean(connection.encryptedRefreshToken) && connection.status === OAuthConnectionStatus.ACTIVE,
      status: connection.status,
      grantedEmail: connection.grantedEmail,
      scopes: splitCsv(connection.scopesCsv),
      managerCustomerId: connection.managerCustomerId,
      refreshTokenExpiresAt: connection.refreshTokenExpiresAt?.toISOString() ?? null,
      tokenWarning: {
        shouldWarn: tokenDaysLeft !== null && tokenDaysLeft <= env.GOOGLE_OAUTH_TOKEN_ALERT_DAYS,
        daysLeft: tokenDaysLeft
      }
    },
    accounts: {
      total,
      inMcc,
      enabledForIngestion,
      activeConfigs
    },
    lastSync
  };
}

export async function startGoogleOAuth(redirectPath?: string | null) {
  assertGoogleOAuthConfig();
  await ensureConnection();
  const normalizedRedirectPath = normalizeRedirectPath(redirectPath);
  const now = new Date();

  await prisma.googleOAuthState.deleteMany({
    where: {
      OR: [
        {
          expiresAt: {
            lt: now
          }
        },
        {
          usedAt: {
            not: null
          },
          createdAt: {
            lt: new Date(now.getTime() - 7 * DAY_MS)
          }
        }
      ]
    }
  });

  const stateRaw = randomToken();
  const expiresAt = new Date(now.getTime() + env.GOOGLE_OAUTH_STATE_TTL_MINUTES * 60 * 1000);

  await prisma.googleOAuthState.create({
    data: {
      stateHash: hashRaw(stateRaw),
      redirectPath: normalizedRedirectPath,
      expiresAt,
      connectionId: 'GOOGLE'
    }
  });

  const oauth = buildOAuthClient();
  const authUrl = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: getGoogleOAuthScopes(),
    state: stateRaw
  });

  return {
    authUrl,
    expiresAt: expiresAt.toISOString(),
    statePreview: env.NODE_ENV === 'production' ? null : stateRaw
  };
}

export async function completeGoogleOAuth(params: { code: string; state: string }) {
  assertGoogleOAuthConfig();

  const stateHash = hashRaw(params.state);
  const state = await prisma.googleOAuthState.findUnique({
    where: { stateHash },
    include: {
      connection: true
    }
  });

  if (!state || state.usedAt) {
    throw new ApiError(400, 'OAuth state is invalid. Start authorization again.');
  }

  if (state.expiresAt.getTime() <= Date.now()) {
    await prisma.googleOAuthState.update({
      where: { id: state.id },
      data: {
        usedAt: new Date()
      }
    });

    throw new ApiError(400, 'OAuth state is expired. Start authorization again.');
  }

  const oauth = buildOAuthClient();

  let tokenResponse;
  try {
    tokenResponse = await oauth.getToken(params.code);
  } catch (error) {
    throw new ApiError(400, 'Google OAuth callback failed.', { reason: toErrorMessage(error) });
  }

  const tokens = tokenResponse.tokens;

  let refreshToken = tokens.refresh_token ?? null;
  if (!refreshToken && state.connection.encryptedRefreshToken) {
    refreshToken = decryptSecret(state.connection.encryptedRefreshToken);
  }

  if (!refreshToken) {
    throw new ApiError(400, 'Google did not return refresh token. Reconnect with consent prompt.');
  }

  const accessToken = tokens.access_token ?? null;
  const fetchedEmail = accessToken ? await fetchGrantedEmail(accessToken) : null;
  const grantedEmail = fetchedEmail ? assertAllowedGoogleLoginEmail(fetchedEmail) : null;
  const scopes =
    typeof tokens.scope === 'string' && tokens.scope.trim().length > 0
      ? tokens.scope.split(/\s+/)
      : getGoogleOAuthScopes();

  if (!grantedEmail) {
    await prisma.googleOAuthState.update({
      where: { id: state.id },
      data: {
        usedAt: new Date()
      }
    });

    throw new ApiError(403, 'Google account email is missing or not allowed for this service.');
  }

  const refreshTokenExpiresAt = deriveRefreshTokenExpiry(tokens) ?? state.connection.refreshTokenExpiresAt;

  await prisma.$transaction(async (tx) => {
    await tx.googleOAuthState.update({
      where: { id: state.id },
      data: {
        usedAt: new Date()
      }
    });

    await tx.googleOAuthConnection.update({
      where: { id: state.connectionId },
      data: {
        status: OAuthConnectionStatus.ACTIVE,
        clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? state.connection.clientId,
        scopesCsv: joinCsv(scopes),
        encryptedRefreshToken: encryptSecret(refreshToken),
        grantedEmail,
        managerCustomerId: normalizeCustomerId(env.GOOGLE_ADS_MANAGER_CUSTOMER_ID) ?? state.connection.managerCustomerId,
        refreshTokenExpiresAt,
        tokenIssuedAt: new Date(),
        lastTokenRefreshAt: new Date(),
        tokenWarningSentAt: null,
        connectedAt: state.connection.connectedAt ?? new Date(),
        disconnectedAt: null
      }
    });
  });

  return {
    status: 'connected',
    redirectPath: state.redirectPath,
    grantedEmail,
    managerCustomerId: normalizeCustomerId(env.GOOGLE_ADS_MANAGER_CUSTOMER_ID),
    refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString() ?? null
  };
}

export async function disconnectGoogleOAuth() {
  await ensureConnection();

  await prisma.googleOAuthConnection.update({
    where: { id: 'GOOGLE' },
    data: {
      status: OAuthConnectionStatus.DISCONNECTED,
      encryptedRefreshToken: null,
      refreshTokenExpiresAt: null,
      tokenWarningSentAt: null,
      disconnectedAt: new Date()
    }
  });

  return {
    status: 'disconnected'
  } as const;
}

export async function getGoogleOAuthRuntimeToken(): Promise<GoogleRuntimeToken> {
  const connection = await getConnectionOrThrow();

  if (!connection.encryptedRefreshToken) {
    throw new ApiError(400, 'Google OAuth is not connected.');
  }

  const accessToken = await getGoogleAccessToken(connection.id);

  return {
    connectionId: connection.id,
    accessToken,
    scopes: splitCsv(connection.scopesCsv),
    grantedEmail: connection.grantedEmail ?? null,
    refreshTokenExpiresAt: connection.refreshTokenExpiresAt,
    status: connection.status
  };
}

export async function getGoogleAdsRuntimeCredentials(): Promise<GoogleAdsRuntimeCredentials> {
  const { managerCustomerId, developerToken } = assertGoogleAdsConfig();
  const oauth = await getGoogleOAuthRuntimeToken();

  return {
    connectionId: oauth.connectionId,
    managerCustomerId,
    developerToken,
    accessToken: oauth.accessToken
  };
}

export async function syncMccAccounts() {
  const credentials = await getGoogleAdsRuntimeCredentials();

  const syncRun = await prisma.googleAdsSyncRun.create({
    data: {
      status: SyncRunStatus.RUNNING,
      connectionId: credentials.connectionId
    }
  });

  try {
    const snapshot = await fetchManagedAccountsFromMcc({
      accessToken: credentials.accessToken,
      managerCustomerId: credentials.managerCustomerId,
      developerToken: credentials.developerToken
    });

    const summary = await applyMccSnapshot({
      connectionId: credentials.connectionId,
      items: snapshot
    });

    await prisma.$transaction(async (tx) => {
      await tx.googleAdsSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: SyncRunStatus.SUCCESS,
          finishedAt: new Date(),
          totalSeen: summary.totalSeen,
          discoveredCount: summary.discoveredCount,
          reappearedCount: summary.reappearedCount,
          detachedCount: summary.detachedCount
        }
      });

      await tx.googleOAuthConnection.update({
        where: { id: credentials.connectionId },
        data: {
          status: OAuthConnectionStatus.ACTIVE,
          managerCustomerId: credentials.managerCustomerId
        }
      });
    });

    return {
      syncRunId: syncRun.id,
      ...summary
    };
  } catch (error) {
    const reason = toErrorMessage(error);

    await prisma.googleAdsSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: SyncRunStatus.FAILED,
        finishedAt: new Date(),
        errorSummary: reason
      }
    });

    throw new ApiError(502, 'Failed to sync MCC accounts.', { reason });
  }
}

export async function listGoogleAdsAccounts(filters: AccountFilters = {}) {
  const take = Math.min(Math.max(filters.take ?? 200, 1), 500);
  const where = buildAccountWhere(filters);

  const [total, items] = await Promise.all([
    prisma.adsAccount.count({ where }),
    prisma.adsAccount.findMany({
      where,
      take,
      orderBy: [{ isInMcc: 'desc' }, { updatedAt: 'desc' }],
      include: {
        sheetConfig: true
      }
    })
  ]);

  return {
    items,
    meta: {
      total,
      take,
      hasMore: total > items.length
    }
  };
}

export async function getGoogleAdsAccountById(accountId: string) {
  const account = await prisma.adsAccount.findUnique({
    where: { id: accountId },
    include: {
      sheetConfig: true
    }
  });

  if (!account) {
    throw new ApiError(404, 'Google Ads account not found.');
  }

  return account;
}

export async function updateGoogleAdsAccount(accountId: string, payload: { ingestionEnabled?: boolean }) {
  const account = await prisma.adsAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true
    }
  });

  if (!account) {
    throw new ApiError(404, 'Google Ads account not found.');
  }

  return prisma.adsAccount.update({
    where: {
      id: account.id
    },
    data: {
      ingestionEnabled: payload.ingestionEnabled
    },
    include: {
      sheetConfig: true
    }
  });
}

export function parseScopesCsv(scopesCsv: string | null | undefined): string[] {
  return splitCsv(scopesCsv);
}
