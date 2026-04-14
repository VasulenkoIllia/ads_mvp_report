import {
  ApiOutlined,
  AppstoreOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  SettingOutlined,
  SyncOutlined,
  TableOutlined
} from '@ant-design/icons';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from 'antd';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

type MenuKey = 'overview' | 'accounts' | 'ingestion' | 'sheets' | 'scheduler';

type GoogleStatus = {
  oauth: {
    configured: boolean;
    connected: boolean;
    status: string;
    grantedEmail: string | null;
    refreshTokenExpiresAt: string | null;
    tokenWarning?: {
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
  lastSync: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
  } | null;
};

type AdsAccount = {
  id: string;
  customerId: string;
  descriptiveName: string;
  googleStatus: string | null;
  isInMcc: boolean;
  isManager: boolean;
  ingestionEnabled: boolean;
};

type SheetConfig = {
  id: string;
  adsAccountId: string;
  spreadsheetId: string;
  sheetName: string;
  writeMode: 'APPEND' | 'OVERWRITE' | 'UPSERT';
  dataMode: 'CAMPAIGN' | 'DAILY_TOTAL';
  columnMode: 'ALL' | 'MANUAL';
  selectedColumns: string[];
  campaignStatuses: string[];
  active: boolean;
};

type AccountRow = AdsAccount & {
  sheetConfigs: SheetConfig[];
  primarySheetConfig: SheetConfig | null;
};

type IngestionRun = {
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
  errorSummary?: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type IngestionAccountRun = {
  id: string;
  runDate: string;
  status: string;
  rowsUpserted: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
  adsAccount?: {
    id: string;
    customerId: string;
    descriptiveName: string;
  };
};

type IngestionRunDetails = IngestionRun & {
  accountRuns: IngestionAccountRun[];
};

type SheetRun = {
  id: string;
  runDate: string;
  status: string;
  triggerSource: string;
  rowsPrepared: number;
  rowsWritten: number;
  rowsFailed: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
  config?: {
    spreadsheetId?: string;
    sheetName?: string;
    writeMode?: 'APPEND' | 'OVERWRITE' | 'UPSERT';
    dataMode?: 'CAMPAIGN' | 'DAILY_TOTAL';
    columnMode?: 'ALL' | 'MANUAL';
    selectedColumnsCsv?: string;
    active?: boolean;
    adsAccount?: {
      customerId: string;
      descriptiveName: string;
    };
  };
};

type SheetRunLaunchItem = {
  configId: string;
  runId: string;
  status: string;
  rowsPrepared: number;
  rowsWritten: number;
  rowsFailed: number;
  errorSummary: string | null;
};

type SheetRunLaunchResponse = {
  runDate: string;
  items: SheetRunLaunchItem[];
};

type SheetManualRangeRunDay = {
  id: string;
  runDate: string;
  status: string;
  rowsPrepared: number;
  rowsWritten: number;
  rowsSkipped: number;
  rowsFailed: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
};

type SheetManualRangeRun = {
  id: string;
  adsAccountId: string;
  spreadsheetId: string;
  sheetName: string;
  writeMode: 'APPEND' | 'OVERWRITE' | 'UPSERT';
  dataMode: 'CAMPAIGN' | 'DAILY_TOTAL';
  columnMode: 'ALL' | 'MANUAL';
  selectedColumns: string[];
  campaignStatuses: string[];
  dateFrom: string;
  dateTo: string;
  totalDays: number;
  completedDays: number;
  successDays: number;
  failedDays: number;
  status: string;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
  adsAccount?: {
    id: string;
    customerId: string;
    descriptiveName: string;
  };
  dayRuns?: SheetManualRangeRunDay[];
};

type SheetConfigFormPayload = {
  spreadsheetId: string;
  sheetName: string;
  writeMode: 'APPEND' | 'OVERWRITE' | 'UPSERT';
  dataMode: 'CAMPAIGN' | 'DAILY_TOTAL';
  columnMode: 'ALL' | 'MANUAL';
  selectedColumns: string[];
  campaignStatuses: string[];
};

type SchedulerSettings = {
  timezone: string;
  ingestionEnabled: boolean;
  ingestionHour: number;
  ingestionMinute: number;
  ingestionMaxDailyAttempts: number;
  ingestionRetryDelayMin: number;
  ingestionBatchSize: number;
  ingestionMaxAccounts: number;
  sheetsEnabled: boolean;
  sheetsHour: number;
  sheetsMinute: number;
  sheetsMaxDailyAttempts: number;
  sheetsRetryDelayMin: number;
  sheetsMaxConfigsPerTick: number;
};

type SchedulerHealth = {
  settings: SchedulerSettings;
  runtime: {
    pollSeconds: number;
    catchupDays: number;
    nextIngestionAt: string;
    nextSheetsAt: string;
  };
};

type AuthSession = {
  authenticated: boolean;
  email: string;
  expiresAt: string;
  expiresInDays: number;
};

type SheetsColumnsCatalog = {
  availableColumns: string[];
};

type SheetManualRangeRunLaunchResponse = {
  run: SheetManualRangeRun;
};

const FALLBACK_EXPORT_COLUMNS = [
  'date',
  'customer_id',
  'account_name',
  'campaign_id',
  'campaign_name',
  'campaign_status',
  'impressions',
  'clicks',
  'ctr_percent',
  'average_cpc',
  'cost',
  'conversions',
  'cost_per_conversion',
  'conversion_value',
  'conversion_value_per_cost',
  'final_url_suffix',
  'tracking_url_template',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content'
] as const;

const REQUIRED_UPSERT_COLUMNS = ['date', 'customer_id', 'campaign_id'] as const;

const COLUMN_LABELS: Record<string, string> = {
  date: 'Дата',
  customer_id: 'Customer ID',
  account_name: 'Назва акаунта',
  campaign_id: 'Campaign ID',
  campaign_name: 'Назва кампанії',
  campaign_status: 'Статус кампанії',
  impressions: 'Покази',
  clicks: 'Кліки',
  ctr_percent: 'CTR (%)',
  average_cpc: 'Avg CPC',
  cost: 'Витрати',
  conversions: 'Конверсії',
  cost_per_conversion: 'Cost / Conv',
  conversion_value: 'Цінність конв.',
  conversion_value_per_cost: 'Цінність конв. / cost',
  final_url_suffix: 'Final URL Suffix',
  tracking_url_template: 'Tracking URL Template',
  utm_source: 'UTM Source',
  utm_medium: 'UTM Medium',
  utm_campaign: 'UTM Campaign',
  utm_term: 'UTM Term',
  utm_content: 'UTM Content'
};

const DEFAULT_CAMPAIGN_STATUS_OPTIONS = ['ENABLED', 'PAUSED', 'REMOVED'];
const menuLabelByKey: Record<MenuKey, string> = {
  overview: 'Огляд',
  accounts: 'Акаунти',
  ingestion: 'Завантаження',
  sheets: 'Експорт в Sheets',
  scheduler: 'Планувальник'
};

const menuDescriptionByKey: Record<MenuKey, string> = {
  overview: 'Статус OAuth, здоров\'я процесів ingestion/export і швидкі дії.',
  accounts: 'Керування підконтрольними акаунтами, ingestion-прапорцем і Sheets-конфігом.',
  ingestion: 'Ручне разове завантаження за період + перемикач автоматичного завантаження за вчора.',
  sheets: 'Ручний разовий експорт у Google Sheets за період. Авто-конфіг редагується лише в Акаунтах.',
  scheduler: 'Налаштування двох cron: ingestion і Sheets export (час, retries, limits).'
};

const menuItems: MenuProps['items'] = [
  {
    key: 'integration',
    icon: <ApiOutlined />,
    label: 'Інтеграція',
    children: [
      { key: 'overview', icon: <AppstoreOutlined />, label: menuLabelByKey.overview },
      { key: 'accounts', icon: <ApiOutlined />, label: menuLabelByKey.accounts }
    ]
  },
  {
    key: 'operations',
    icon: <DatabaseOutlined />,
    label: 'Операції',
    children: [
      { key: 'ingestion', icon: <DatabaseOutlined />, label: menuLabelByKey.ingestion },
      { key: 'sheets', icon: <TableOutlined />, label: menuLabelByKey.sheets }
    ]
  },
  {
    key: 'automation',
    icon: <CalendarOutlined />,
    label: 'Автоматизація',
    children: [{ key: 'scheduler', icon: <SettingOutlined />, label: menuLabelByKey.scheduler }]
  }
];

class ApiRequestError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('uk-UA');
}

function formatGoogleAdsCustomerId(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  const digitsOnly = value.replace(/\D/g, '');
  if (digitsOnly.length !== 10) {
    return value;
  }

  return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6, 10)}`;
}

function normalizeGoogleAdsCustomerId(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function formatDateOnly(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  return value.slice(0, 10);
}

function formatTimeOfDay(hour: number | null | undefined, minute: number | null | undefined): string {
  if (typeof hour !== 'number' || typeof minute !== 'number') {
    return '-';
  }

  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

function statusTag(status: string): JSX.Element {
  const upper = status.toUpperCase();

  if (['SUCCESS', 'ACTIVE', 'CONNECTED'].includes(upper)) {
    return <Tag color="success">{status}</Tag>;
  }

  if (['FAILED', 'ERROR', 'NEEDS_REAUTH', 'DISCONNECTED'].includes(upper)) {
    return <Tag color="error">{status}</Tag>;
  }

  if (['RUNNING', 'PARTIAL'].includes(upper)) {
    return <Tag color="processing">{status}</Tag>;
  }

  if (['CANCELLED', 'SKIPPED'].includes(upper)) {
    return <Tag color="default">{status}</Tag>;
  }

  return <Tag>{status}</Tag>;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter((item) => item.length > 0);
}

function normalizeCampaignStatusesInput(value: unknown): string[] {
  return Array.from(new Set(normalizeStringArray(value).map((item) => item.toUpperCase())));
}

function ensureRequiredUpsertColumns(columns: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const column of REQUIRED_UPSERT_COLUMNS) {
    if (!seen.has(column)) {
      result.push(column);
      seen.add(column);
    }
  }

  for (const column of columns) {
    if (!seen.has(column)) {
      result.push(column);
      seen.add(column);
    }
  }

  return result;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function toDateOnlyInput(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (dayjs.isDayjs(value)) {
    const normalized = value.format('YYYY-MM-DD').trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return dayjs(value).format('YYYY-MM-DD');
  }

  return undefined;
}

function toColumnSelectLabel(key: string): string {
  return `${COLUMN_LABELS[key] ?? key} (${key})`;
}

function isActiveGoogleAccountStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toUpperCase() === 'ENABLED';
}

export function App() {
  const [activeMenu, setActiveMenu] = useState<MenuKey>('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [openMenuKeys, setOpenMenuKeys] = useState<string[]>(['integration', 'operations', 'automation']);
  const [authChecking, setAuthChecking] = useState(true);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);

  const [loading, setLoading] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [ingestionRuns, setIngestionRuns] = useState<IngestionRun[]>([]);
  const [sheetRuns, setSheetRuns] = useState<SheetRun[]>([]);
  const [sheetManualRangeRuns, setSheetManualRangeRuns] = useState<SheetManualRangeRun[]>([]);

  const [ingestionHealth, setIngestionHealth] = useState<any>(null);
  const [sheetsHealth, setSheetsHealth] = useState<any>(null);
  const [schedulerHealth, setSchedulerHealth] = useState<SchedulerHealth | null>(null);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);

  const [requestOutput, setRequestOutput] = useState<string>('{}');
  const [requestError, setRequestError] = useState<string | null>(null);

  const [ingestionForm] = Form.useForm();
  const [sheetRunForm] = Form.useForm();
  const [schedulerForm] = Form.useForm();
  const [configForm] = Form.useForm();
  const sheetFormColumnMode = Form.useWatch('columnMode', sheetRunForm) ?? 'ALL';
  const configFormColumnMode = Form.useWatch('columnMode', configForm) ?? 'ALL';

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [autoIngestionSaving, setAutoIngestionSaving] = useState(false);
  const [ingestionSubmitting, setIngestionSubmitting] = useState(false);
  const [sheetRunSubmitting, setSheetRunSubmitting] = useState(false);
  const [ingestionRunDrawerOpen, setIngestionRunDrawerOpen] = useState(false);
  const [ingestionRunDrawerLoading, setIngestionRunDrawerLoading] = useState(false);
  const [selectedIngestionRunDetails, setSelectedIngestionRunDetails] = useState<IngestionRunDetails | null>(null);
  const [manualRangeRunDrawerOpen, setManualRangeRunDrawerOpen] = useState(false);
  const [manualRangeRunDrawerLoading, setManualRangeRunDrawerLoading] = useState(false);
  const [selectedManualRangeRun, setSelectedManualRangeRun] = useState<SheetManualRangeRun | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<AccountRow | null>(null);
  const [selectedDrawerConfigId, setSelectedDrawerConfigId] = useState<string | null>(null);
  const [accountsQuery, setAccountsQuery] = useState('');
  const [accountsIngestionFilter, setAccountsIngestionFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [accountsStatusFilter, setAccountsStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');

  const request = useCallback(
    async <T,>(path: string, options: RequestInit & { json?: unknown } = {}): Promise<T> => {
      const headers: HeadersInit = {
        ...(options.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {})
      };

      const response = await fetch(path, {
        ...options,
        credentials: 'include',
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : options.body
      });

      const isJson = response.headers.get('content-type')?.includes('application/json');
      const payload = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const messageText =
          typeof payload === 'string' ? payload : payload?.message || payload?.error || response.statusText;
        if (response.status === 401 && !path.startsWith('/api/v1/auth/session')) {
          setAuthSession(null);
        }
        throw new ApiRequestError(response.status, payload, messageText);
      }

      return payload as T;
    },
    []
  );

  const loadAuthSession = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/auth/session', {
        credentials: 'include'
      });

      if (!response.ok) {
        setAuthSession(null);
        return;
      }

      const payload = (await response.json()) as AuthSession;
      setAuthSession(payload);
    } catch {
      setAuthSession(null);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    const [accountsResp, configsResp] = await Promise.all([
      request<{ items: AdsAccount[] }>('/api/v1/google/accounts?take=500'),
      request<{ items: SheetConfig[] }>('/api/v1/sheets/configs?take=500')
    ]);

    const configByAccount = new Map<string, SheetConfig[]>();
    for (const config of configsResp.items) {
      const list = configByAccount.get(config.adsAccountId);
      if (list) {
        list.push(config);
      } else {
        configByAccount.set(config.adsAccountId, [config]);
      }
    }

    const rows: AccountRow[] = accountsResp.items.map((item) => ({
      ...item,
      sheetConfigs: configByAccount.get(item.id) ?? [],
      primarySheetConfig: configByAccount.get(item.id)?.[0] ?? null
    }));

    setAccounts(rows);
  }, [request]);

  const loadOverview = useCallback(async () => {
    const [status, ingestionHealthResp, sheetsHealthResp, schedulerSettingsResp, schedulerHealthResp] =
      await Promise.all([
        request<GoogleStatus>('/api/v1/google/status'),
        request<any>('/api/v1/ingestion/health'),
        request<any>('/api/v1/sheets/health'),
        request<SchedulerSettings>('/api/v1/scheduler/settings'),
        request<SchedulerHealth>('/api/v1/scheduler/health')
      ]);

    setGoogleStatus(status);
    setIngestionHealth(ingestionHealthResp);
    setSheetsHealth(sheetsHealthResp);
    setSchedulerHealth(schedulerHealthResp);

    schedulerForm.setFieldsValue(schedulerSettingsResp);
  }, [request, schedulerForm]);

  const loadSheetColumnsCatalog = useCallback(async () => {
    const catalog = await request<SheetsColumnsCatalog>('/api/v1/sheets/columns-catalog');
    if (Array.isArray(catalog.availableColumns) && catalog.availableColumns.length > 0) {
      setAvailableColumns(catalog.availableColumns);
      return;
    }

    setAvailableColumns(Array.from(FALLBACK_EXPORT_COLUMNS));
  }, [request]);

  const loadRuns = useCallback(async () => {
    const [ingestionRunsResp, sheetRunsResp, manualRangeRunsResp] = await Promise.all([
      request<{ items: IngestionRun[] }>('/api/v1/ingestion/runs?take=30'),
      request<{ items: SheetRun[] }>('/api/v1/sheets/runs?take=30'),
      request<{ items: SheetManualRangeRun[] }>('/api/v1/sheets/manual-range-runs?take=30')
    ]);

    setIngestionRuns(ingestionRunsResp.items);
    setSheetRuns(sheetRunsResp.items);
    setSheetManualRangeRuns(manualRangeRunsResp.items);
  }, [request]);

  const refreshAll = useCallback(async () => {
    if (!authSession) {
      return;
    }

    setLoading(true);
    setRequestError(null);

    try {
      await Promise.all([loadOverview(), loadAccounts(), loadRuns(), loadSheetColumnsCatalog()]);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setRequestError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [authSession, loadOverview, loadAccounts, loadRuns, loadSheetColumnsCatalog]);

  useEffect(() => {
    const run = async () => {
      setAuthChecking(true);
      await loadAuthSession();
      setAuthChecking(false);
    };

    void run();
  }, [loadAuthSession]);

  useEffect(() => {
    if (!authSession) {
      setLoading(false);
      return;
    }

    void refreshAll();
  }, [authSession, refreshAll]);

  useEffect(() => {
    if (!authSession) {
      return;
    }

    const hasRunningIngestion = ingestionRuns.some((item) => item.status === 'RUNNING');
    const hasRunningManualSheetRange = sheetManualRangeRuns.some((item) => item.status === 'RUNNING');
    if (!ingestionSubmitting && !sheetRunSubmitting && !hasRunningIngestion && !hasRunningManualSheetRange) {
      return;
    }

    const timer = window.setInterval(() => {
      void Promise.all([loadRuns(), loadOverview()]).catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [authSession, ingestionRuns, ingestionSubmitting, loadRuns, loadOverview, sheetManualRangeRuns, sheetRunSubmitting]);

  useEffect(() => {
    if (sheetFormColumnMode !== 'MANUAL') {
      return;
    }

    const current = normalizeStringArray(sheetRunForm.getFieldValue('selectedColumns'));
    const next = ensureRequiredUpsertColumns(current);
    if (!areStringArraysEqual(current, next)) {
      sheetRunForm.setFieldsValue({
        selectedColumns: next
      });
    }
  }, [sheetFormColumnMode, sheetRunForm]);

  useEffect(() => {
    if (configFormColumnMode !== 'MANUAL') {
      return;
    }

    const current = normalizeStringArray(configForm.getFieldValue('selectedColumns'));
    const next = ensureRequiredUpsertColumns(current);
    if (!areStringArraysEqual(current, next)) {
      configForm.setFieldsValue({
        selectedColumns: next
      });
    }
  }, [configForm, configFormColumnMode]);

  const handleLogin = async () => {
    try {
      const result = await request<{ authUrl: string }>('/api/v1/auth/login/start?redirectPath=%2F');
      window.location.href = result.authUrl;
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleLogout = async () => {
    try {
      await request('/api/v1/auth/logout', { method: 'POST' });
      setAuthSession(null);
      message.success('Вихід виконано.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSyncAccounts = async () => {
    try {
      const result = await request('/api/v1/google/accounts/sync', { method: 'POST' });
      setRequestOutput(JSON.stringify(result, null, 2));
      message.success('Синхронізація MCC завершена.');
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleToggleIngestion = async (accountId: string, enabled: boolean) => {
    try {
      await request(`/api/v1/google/accounts/${accountId}`, {
        method: 'PATCH',
        json: {
          ingestionEnabled: enabled
        }
      });

      setAccounts((prev) => prev.map((item) => (item.id === accountId ? { ...item, ingestionEnabled: enabled } : item)));
      message.success('Прапорець ingestion оновлено.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const applyAccountConfigToDrawerForm = useCallback(
    (account: AccountRow, config: SheetConfig | null) => {
      configForm.setFieldsValue({
        ingestionEnabled: account.ingestionEnabled,
        spreadsheetId: config?.spreadsheetId ?? '',
        sheetName: config?.sheetName ?? '',
        active: config?.active ?? true,
        writeMode: config?.writeMode ?? 'UPSERT',
        dataMode: config?.dataMode ?? 'CAMPAIGN',
        columnMode: config?.columnMode ?? 'ALL',
        selectedColumns:
          config?.columnMode === 'MANUAL'
            ? ensureRequiredUpsertColumns(config?.selectedColumns ?? [])
            : config?.selectedColumns ?? [],
        campaignStatuses: config?.campaignStatuses ?? []
      });
    },
    [configForm]
  );

  const openConfigDrawer = (account: AccountRow) => {
    const initialConfig = account.primarySheetConfig ?? null;
    setSelectedAccount(account);
    setSelectedDrawerConfigId(initialConfig?.id ?? null);
    applyAccountConfigToDrawerForm(account, initialConfig);
    setDrawerOpen(true);
  };

  const handleSelectDrawerConfig = (value: string) => {
    if (!selectedAccount) {
      return;
    }

    if (value === '__new__') {
      setSelectedDrawerConfigId(null);
      applyAccountConfigToDrawerForm(selectedAccount, null);
      return;
    }

    const matched = selectedAccount.sheetConfigs.find((item) => item.id === value) ?? null;
    setSelectedDrawerConfigId(matched?.id ?? null);
    applyAccountConfigToDrawerForm(selectedAccount, matched);
  };

  const handleStartNewConfig = () => {
    if (!selectedAccount) {
      return;
    }

    setSelectedDrawerConfigId(null);
    applyAccountConfigToDrawerForm(selectedAccount, null);
  };

  const handleSaveConfig = async () => {
    if (!selectedAccount) {
      return;
    }

    try {
      setDrawerSaving(true);
      const values = await configForm.validateFields();

      await request(`/api/v1/google/accounts/${selectedAccount.id}`, {
        method: 'PATCH',
        json: {
          ingestionEnabled: values.ingestionEnabled
        }
      });

      const spreadsheetId = String(values.spreadsheetId ?? '').trim();
      const sheetName = String(values.sheetName ?? '').trim();

      if (spreadsheetId.length > 0 || sheetName.length > 0) {
        if (spreadsheetId.length === 0 || sheetName.length === 0) {
          throw new Error('Для збереження config потрібно заповнити і Spreadsheet ID, і Sheet Name.');
        }

        const selectedColumns =
          values.columnMode === 'MANUAL'
            ? ensureRequiredUpsertColumns(normalizeStringArray(values.selectedColumns))
            : normalizeStringArray(values.selectedColumns);
        const campaignStatuses = normalizeCampaignStatusesInput(values.campaignStatuses);

        await request(`/api/v1/sheets/configs/${selectedAccount.id}`, {
          method: 'PUT',
          json: {
            configId: selectedDrawerConfigId ?? undefined,
            createNew: selectedDrawerConfigId === null,
            spreadsheetId,
            sheetName,
            writeMode: 'UPSERT',
            dataMode: values.dataMode,
            columnMode: values.columnMode,
            selectedColumns,
            campaignStatuses,
            active: values.active
          }
        });
      }

      message.success('Налаштування акаунта збережено.');
      setDrawerOpen(false);
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDrawerSaving(false);
    }
  };

  const handleDeleteConfig = async () => {
    if (!selectedDrawerConfigId) {
      message.warning('Оберіть існуючий config для видалення.');
      return;
    }

    try {
      await request(`/api/v1/sheets/configs/${selectedDrawerConfigId}`, {
        method: 'DELETE'
      });
      message.success('Sheet config видалено.');
      setDrawerOpen(false);
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRunIngestion = async () => {
    const toastKey = 'ingestion-run-toast';

    try {
      setIngestionSubmitting(true);
      message.open({
        key: toastKey,
        type: 'loading',
        content: 'Запускаю ручне завантаження...'
      });

      const values = await ingestionForm.validateFields();
      const dateFrom = toDateOnlyInput(values.dateFrom);
      const dateTo = toDateOnlyInput(values.dateTo);

      if (!dateFrom || !dateTo) {
        message.error({
          key: toastKey,
          content: 'Оберіть обидві дати: "Період від" і "Період до".'
        });
        return;
      }
      if (dateFrom > dateTo) {
        message.error({
          key: toastKey,
          content: 'Дата "Період від" не може бути більшою за "Період до".'
        });
        return;
      }

      const payload = {
        dateFrom,
        dateTo,
        accountId: values.accountId || undefined,
        takeAccounts: values.takeAccounts || undefined,
        batchSize: values.batchSize || undefined,
        enabledOnly: values.enabledOnly
      };

      const result = await request('/api/v1/ingestion/runs', {
        method: 'POST',
        json: payload
      });

      setRequestOutput(JSON.stringify(result, null, 2));
      message.success({
        key: toastKey,
        content: 'Ручне завантаження завершено.'
      });
      await refreshAll();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        const details = (error.payload as { details?: { runningRun?: { id?: string; startedAt?: string } } } | null)
          ?.details;
        const runningRun = details?.runningRun;
        if (runningRun?.id) {
          message.warning({
            key: toastKey,
            content: `Запуск вже виконується (runId: ${runningRun.id}). Слідкуй за прогресом нижче в таблиці.`
          });
          setRequestOutput(JSON.stringify(details, null, 2));
          await refreshAll();
          return;
        }
      }

      message.error({
        key: toastKey,
        content: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setIngestionSubmitting(false);
    }
  };

  const handlePreflight = async () => {
    try {
      const values = await ingestionForm.validateFields();
      const params = new URLSearchParams();
      const dateFrom = toDateOnlyInput(values.dateFrom);
      const dateTo = toDateOnlyInput(values.dateTo);
      if (!dateFrom || !dateTo) {
        message.error('Оберіть обидві дати: "Період від" і "Період до".');
        return;
      }
      if (dateFrom > dateTo) {
        message.error('Дата "Період від" не може бути більшою за "Період до".');
        return;
      }

      params.set('dateFrom', dateFrom);
      params.set('dateTo', dateTo);
      if (values.accountId) params.set('accountId', values.accountId);
      if (values.takeAccounts) params.set('takeAccounts', String(values.takeAccounts));
      if (values.batchSize) params.set('batchSize', String(values.batchSize));
      if (typeof values.enabledOnly === 'boolean') params.set('enabledOnly', String(values.enabledOnly));

      const result = await request(`/api/v1/ingestion/preflight?${params.toString()}`);
      setRequestOutput(JSON.stringify(result, null, 2));
      message.success('Preflight виконано.');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenIngestionRunDetails = async (runId: string) => {
    try {
      setIngestionRunDrawerOpen(true);
      setIngestionRunDrawerLoading(true);

      const result = await request<IngestionRunDetails>(`/api/v1/ingestion/runs/${runId}`);
      setSelectedIngestionRunDetails(result);
      setRequestOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIngestionRunDrawerLoading(false);
    }
  };

  const handleOpenManualRangeRunDetails = async (runId: string) => {
    try {
      setManualRangeRunDrawerOpen(true);
      setManualRangeRunDrawerLoading(true);

      const result = await request<SheetManualRangeRun>(`/api/v1/sheets/manual-range-runs/${runId}`);
      setSelectedManualRangeRun(result);
      setRequestOutput(JSON.stringify(result, null, 2));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setManualRangeRunDrawerLoading(false);
    }
  };

  const buildSheetConfigPayloadFromValues = (values: Record<string, unknown>): SheetConfigFormPayload => {
    const spreadsheetId = String(values.spreadsheetId ?? '').trim();
    const sheetName = String(values.sheetName ?? '').trim();

    if (spreadsheetId.length === 0 || sheetName.length === 0) {
      throw new Error('Заповніть Spreadsheet ID і Sheet name.');
    }

    const columnMode = values.columnMode === 'MANUAL' ? 'MANUAL' : 'ALL';
    const selectedColumns =
      columnMode === 'MANUAL'
        ? ensureRequiredUpsertColumns(normalizeStringArray(values.selectedColumns))
        : normalizeStringArray(values.selectedColumns);
    const campaignStatuses = normalizeCampaignStatusesInput(values.campaignStatuses);

    if (columnMode === 'MANUAL' && selectedColumns.length === 0) {
      throw new Error('У режимі MANUAL потрібно обрати хоча б одне поле.');
    }

    const writeMode: SheetConfigFormPayload['writeMode'] = 'UPSERT';
    const dataMode: SheetConfigFormPayload['dataMode'] = values.dataMode === 'DAILY_TOTAL' ? 'DAILY_TOTAL' : 'CAMPAIGN';

    return {
      spreadsheetId,
      sheetName,
      writeMode,
      dataMode,
      columnMode,
      selectedColumns,
      campaignStatuses
    };
  };

  const runSheetsForDate = async (params: { accountId?: string; runDate?: string }) => {
    return request<SheetRunLaunchResponse>('/api/v1/sheets/runs', {
      method: 'POST',
      json: {
        runDate: params.runDate,
        accountId: params.accountId
      }
    });
  };

  const handleRunSheets = async (accountId?: string) => {
    try {
      const result = await runSheetsForDate({
        accountId
      });
      setRequestOutput(JSON.stringify(result, null, 2));
      message.success(`Експорт у Sheets завершено за ${result.runDate}.`);
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRunSheetsManualRange = async () => {
    const toastKey = 'sheets-manual-run-toast';

    try {
      setSheetRunSubmitting(true);
      message.open({
        key: toastKey,
        type: 'loading',
        content: 'Створюю задачу ручного експорту за період...'
      });

      const values = (await sheetRunForm.validateFields()) as Record<string, unknown>;
      const accountId = String(values.accountId ?? '').trim();
      if (accountId.length === 0) {
        throw new Error('Оберіть акаунт.');
      }

      const dateFrom = toDateOnlyInput(values.dateFrom);
      const dateTo = toDateOnlyInput(values.dateTo);
      if (!dateFrom || !dateTo) {
        throw new Error('Оберіть обидві дати: "Період від" і "Період до".');
      }

      if (dateFrom > dateTo) {
        throw new Error('Дата "Період від" не може бути більшою за "Період до".');
      }

      const configPayload = buildSheetConfigPayloadFromValues(values);

      const result = await request<SheetManualRangeRunLaunchResponse>('/api/v1/sheets/manual-range-runs', {
        method: 'POST',
        json: {
          accountId,
          dateFrom,
          dateTo,
          spreadsheetId: configPayload.spreadsheetId,
          sheetName: configPayload.sheetName,
          writeMode: configPayload.writeMode,
          dataMode: configPayload.dataMode,
          columnMode: configPayload.columnMode,
          selectedColumns: configPayload.selectedColumns,
          campaignStatuses: configPayload.campaignStatuses
        }
      });

      setRequestOutput(JSON.stringify(result, null, 2));
      message.success({
        key: toastKey,
        content: `Задачу створено: ${result.run.id}. Виконання йде на бекенді у фоні.`
      });

      await refreshAll();
    } catch (error) {
      message.error({
        key: toastKey,
        content: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSheetRunSubmitting(false);
    }
  };

  const handleSaveScheduler = async () => {
    try {
      const values = await schedulerForm.validateFields();
      const result = await request('/api/v1/scheduler/settings', {
        method: 'PATCH',
        json: values
      });

      setRequestOutput(JSON.stringify(result, null, 2));
      message.success('Scheduler налаштування оновлено.');
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const handleToggleAutoIngestion = async (enabled: boolean) => {
    try {
      setAutoIngestionSaving(true);
      const result = await request<SchedulerSettings>('/api/v1/scheduler/settings', {
        method: 'PATCH',
        json: {
          ingestionEnabled: enabled
        }
      });

      schedulerForm.setFieldsValue(result);
      setRequestOutput(JSON.stringify(result, null, 2));
      message.success(enabled ? 'Автоматичне завантаження увімкнено.' : 'Автоматичне завантаження вимкнено.');
      await refreshAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAutoIngestionSaving(false);
    }
  };

  const ingestionColumns: ColumnsType<IngestionRun> = [
    {
      title: 'Період',
      key: 'period',
      render: (_, row) => `${formatDateOnly(row.dateFrom)} -> ${formatDateOnly(row.dateTo)}`
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      render: (value: string) => statusTag(value)
    },
    {
      title: 'Джерело',
      dataIndex: 'triggerSource',
      render: (value: string) => (value === 'SCHEDULER' ? 'Автоматично (cron)' : 'Ручний запуск')
    },
    {
      title: 'Оброблено акаунтів',
      dataIndex: 'processedAccounts'
    },
    {
      title: 'Всього акаунтів',
      dataIndex: 'totalAccounts'
    },
    {
      title: 'Прогрес',
      key: 'progress',
      render: (_, row) => {
        if (row.totalAccounts <= 0) {
          return '-';
        }

        const percent = Math.round((row.processedAccounts / row.totalAccounts) * 100);
        return `${Math.max(0, Math.min(100, percent))}%`;
      }
    },
    {
      title: 'Помилки акаунтів',
      dataIndex: 'failedAccounts'
    },
    {
      title: 'Рядків в БД',
      dataIndex: 'rowsUpserted'
    },
    {
      title: 'Початок',
      dataIndex: 'startedAt',
      render: (value) => formatDate(value)
    },
    {
      title: 'Деталі',
      key: 'actions',
      render: (_, row) => (
        <Button size="small" onClick={() => void handleOpenIngestionRunDetails(row.id)}>
          {row.failedAccounts > 0 ? 'Помилки' : 'Деталі'}
        </Button>
      )
    }
  ];

  const ingestionRunErrorColumns: ColumnsType<IngestionAccountRun> = [
    {
      title: 'Дата',
      dataIndex: 'runDate',
      render: (value) => formatDateOnly(value)
    },
    {
      title: 'Акаунт',
      dataIndex: 'adsAccount',
      render: (_, row) => row.adsAccount?.descriptiveName ?? '-'
    },
    {
      title: 'Customer ID',
      dataIndex: 'adsAccount',
      render: (_, row) => formatGoogleAdsCustomerId(row.adsAccount?.customerId)
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      render: (value: string) => statusTag(value)
    },
    {
      title: 'Текст помилки',
      dataIndex: 'errorSummary',
      render: (value: string | null) => value ?? '-'
    }
  ];

  const sheetRunColumns: ColumnsType<SheetRun> = [
    {
      title: 'Дата',
      dataIndex: 'runDate',
      render: (value) => formatDateOnly(value)
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      render: (value: string) => statusTag(value)
    },
    {
      title: 'Акаунт',
      dataIndex: 'config',
      render: (_, row) => {
        const account = row.config?.adsAccount;
        return account ? `${account.descriptiveName} (${formatGoogleAdsCustomerId(account.customerId)})` : '-';
      }
    },
    {
      title: 'Куди',
      dataIndex: 'config',
      render: (_, row) => {
        const config = row.config;
        if (!config?.spreadsheetId || !config?.sheetName) {
          return '-';
        }

        return `${config.sheetName} (${config.spreadsheetId.slice(0, 8)}...)`;
      }
    },
    {
      title: 'Підготовлено',
      dataIndex: 'rowsPrepared'
    },
    {
      title: 'Записано',
      dataIndex: 'rowsWritten'
    },
    {
      title: 'Помилки',
      dataIndex: 'rowsFailed'
    },
    {
      title: 'Початок',
      dataIndex: 'startedAt',
      render: (value) => formatDate(value)
    },
    {
      title: 'Опис помилки',
      dataIndex: 'errorSummary',
      render: (value: string | null) => value ?? '-'
    }
  ];

  const sheetManualRangeRunColumns: ColumnsType<SheetManualRangeRun> = [
    {
      title: 'Період',
      key: 'period',
      render: (_, row) => `${formatDateOnly(row.dateFrom)} -> ${formatDateOnly(row.dateTo)}`
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      render: (value: string) => statusTag(value)
    },
    {
      title: 'Акаунт',
      dataIndex: 'adsAccount',
      render: (_, row) =>
        row.adsAccount ? `${row.adsAccount.descriptiveName} (${formatGoogleAdsCustomerId(row.adsAccount.customerId)})` : '-'
    },
    {
      title: 'Прогрес',
      key: 'progress',
      render: (_, row) => `${row.completedDays}/${row.totalDays}`
    },
    {
      title: 'Помилки днів',
      dataIndex: 'failedDays'
    },
    {
      title: 'Початок',
      dataIndex: 'startedAt',
      render: (value) => formatDate(value)
    },
    {
      title: 'Дії',
      key: 'actions',
      render: (_, row) => (
        <Button size="small" onClick={() => void handleOpenManualRangeRunDetails(row.id)}>
          Деталі
        </Button>
      )
    }
  ];

  const sheetManualRangeRunDayColumns: ColumnsType<SheetManualRangeRunDay> = [
    {
      title: 'Дата',
      dataIndex: 'runDate',
      render: (value) => formatDateOnly(value)
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      render: (value: string) => statusTag(value)
    },
    {
      title: 'Підготовлено',
      dataIndex: 'rowsPrepared'
    },
    {
      title: 'Записано',
      dataIndex: 'rowsWritten'
    },
    {
      title: 'Помилки',
      dataIndex: 'rowsFailed'
    },
    {
      title: 'Опис помилки',
      dataIndex: 'errorSummary',
      render: (value: string | null) => value ?? '-'
    },
    {
      title: 'Початок',
      dataIndex: 'startedAt',
      render: (value) => formatDate(value)
    },
    {
      title: 'Завершення',
      dataIndex: 'finishedAt',
      render: (value) => formatDate(value)
    }
  ];

  const accountColumns: ColumnsType<AccountRow> = [
    {
      title: 'Акаунт',
      key: 'account',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.descriptiveName}</Text>
          <Text type="secondary">{formatGoogleAdsCustomerId(row.customerId)}</Text>
        </Space>
      )
    },
    {
      title: 'Стан',
      key: 'state',
      render: (_, row) => (
        <Space wrap>
          {row.isInMcc ? <Tag color="green">MCC</Tag> : <Tag color="default">Поза MCC</Tag>}
          {row.isManager ? <Tag color="warning">Manager</Tag> : <Tag color="blue">Client</Tag>}
          {row.googleStatus ? statusTag(row.googleStatus) : <Tag>-</Tag>}
        </Space>
      )
    },
    {
      title: 'Ingestion',
      key: 'ingestion',
      render: (_, row) => (
        <Switch checked={row.ingestionEnabled} onChange={(value) => void handleToggleIngestion(row.id, value)} />
      )
    },
    {
      title: 'Sheets Config',
      key: 'sheet',
      render: (_, row) => {
        if (row.sheetConfigs.length === 0) {
          return <Tag color="default">Не налаштовано</Tag>;
        }

        const activeCount = row.sheetConfigs.filter((item) => item.active).length;
        const preview = row.sheetConfigs
          .slice(0, 2)
          .map((item) => item.sheetName)
          .join(', ');
        const extraCount = row.sheetConfigs.length - 2;

        return (
          <Space direction="vertical" size={0}>
            <Text>{activeCount}/{row.sheetConfigs.length} active config(s)</Text>
            <Text type="secondary">
              {preview}
              {extraCount > 0 ? ` (+${extraCount})` : ''}
            </Text>
          </Space>
        );
      }
    },
    {
      title: 'Дії',
      key: 'actions',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => openConfigDrawer(row)}>
            Налаштувати
          </Button>
          <Button size="small" icon={<SyncOutlined />} onClick={() => void handleRunSheets(row.id)}>
            Вивантажити
          </Button>
        </Space>
      )
    }
  ];

  const activeAccountOptions = accounts
    .filter((item) => isActiveGoogleAccountStatus(item.googleStatus))
    .map((item) => ({
      label: `${item.descriptiveName} (${formatGoogleAdsCustomerId(item.customerId)})`,
      value: item.id
    }));

  const exportColumnOptions = useMemo(
    () =>
      (availableColumns.length > 0 ? availableColumns : Array.from(FALLBACK_EXPORT_COLUMNS)).map((column) => ({
        label: toColumnSelectLabel(column),
        value: column
      })),
    [availableColumns]
  );

  const campaignStatusOptions = DEFAULT_CAMPAIGN_STATUS_OPTIONS.map((status) => ({
    label: status,
    value: status
  }));

  const filteredAccounts = useMemo(() => {
    const query = accountsQuery.trim().toLowerCase();
    const queryCustomerId = normalizeGoogleAdsCustomerId(query);

    return accounts.filter((item) => {
      const activeByGoogleStatus = isActiveGoogleAccountStatus(item.googleStatus);

      if (accountsIngestionFilter === 'enabled' && !item.ingestionEnabled) {
        return false;
      }

      if (accountsIngestionFilter === 'disabled' && item.ingestionEnabled) {
        return false;
      }

      if (accountsStatusFilter === 'active' && !activeByGoogleStatus) {
        return false;
      }

      if (accountsStatusFilter === 'inactive' && activeByGoogleStatus) {
        return false;
      }

      if (!query) {
        return true;
      }

      const rawCustomerId = item.customerId.toLowerCase();
      const formattedCustomerId = formatGoogleAdsCustomerId(item.customerId).toLowerCase();
      const normalizedCustomerId = normalizeGoogleAdsCustomerId(item.customerId);

      return (
        item.descriptiveName.toLowerCase().includes(query) ||
        rawCustomerId.includes(query) ||
        formattedCustomerId.includes(query) ||
        (queryCustomerId.length > 0 && normalizedCustomerId.includes(queryCustomerId)) ||
        item.sheetConfigs.some(
          (config) =>
            config.sheetName.toLowerCase().includes(query) || config.spreadsheetId.toLowerCase().includes(query)
        )
      );
    });
  }, [accounts, accountsQuery, accountsIngestionFilter, accountsStatusFilter]);

  const currentIngestionRun = useMemo(
    () => ingestionRuns.find((item) => item.status === 'RUNNING') ?? null,
    [ingestionRuns]
  );

  const currentIngestionProgressPercent = useMemo(() => {
    if (!currentIngestionRun || currentIngestionRun.totalAccounts <= 0) {
      return 0;
    }

    const raw = (currentIngestionRun.processedAccounts / currentIngestionRun.totalAccounts) * 100;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }, [currentIngestionRun]);

  const currentManualRangeRun = useMemo(
    () => sheetManualRangeRuns.find((item) => item.status === 'RUNNING') ?? null,
    [sheetManualRangeRuns]
  );

  const currentManualRangeProgressPercent = useMemo(() => {
    if (!currentManualRangeRun || currentManualRangeRun.totalDays <= 0) {
      return 0;
    }

    const raw = (currentManualRangeRun.completedDays / currentManualRangeRun.totalDays) * 100;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }, [currentManualRangeRun]);

  const selectedIngestionFailedAccountRuns = useMemo(
    () =>
      (selectedIngestionRunDetails?.accountRuns ?? []).filter(
        (item) => item.status.toUpperCase() === 'FAILED' || Boolean(item.errorSummary)
      ),
    [selectedIngestionRunDetails]
  );

  const renderOverview = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} lg={6}>
          <Card>
            <Statistic title="OAuth" value={googleStatus?.oauth.connected ? 'Connected' : 'Disconnected'} />
            <Text type="secondary">{googleStatus?.oauth.grantedEmail ?? '-'}</Text>
          </Card>
        </Col>
        <Col xs={24} md={12} lg={6}>
          <Card>
            <Statistic title="Accounts" value={googleStatus?.accounts.total ?? 0} />
            <Text type="secondary">in MCC: {googleStatus?.accounts.inMcc ?? 0}</Text>
          </Card>
        </Col>
        <Col xs={24} md={12} lg={6}>
          <Card>
            <Statistic title="Ingestion Enabled" value={googleStatus?.accounts.enabledForIngestion ?? 0} />
            <Text type="secondary">eligible accounts</Text>
          </Card>
        </Col>
        <Col xs={24} md={12} lg={6}>
          <Card>
            <Statistic title="Sheet Configs" value={googleStatus?.accounts.activeConfigs ?? 0} />
            <Text type="secondary">active exports</Text>
          </Card>
        </Col>
      </Row>

      <Card title="Quick Actions" extra={googleStatus?.oauth.tokenWarning?.shouldWarn ? <Text type="warning">Token warning ({googleStatus.oauth.tokenWarning.daysLeft}d)</Text> : null}>
        <Space wrap>
          <Button icon={<SyncOutlined />} onClick={() => void handleSyncAccounts()}>
            Sync MCC Accounts
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshAll()}>
            Reload
          </Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Ingestion Health">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Running runs">{ingestionHealth?.runs?.runningCount ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="Rows (24h)">{ingestionHealth?.throughput?.rowsUpserted24h ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="Last run status">{ingestionHealth?.runs?.lastRun?.status ? statusTag(ingestionHealth.runs.lastRun.status) : '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Sheets Health">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Active configs">{sheetsHealth?.configs?.active ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="Running exports">{sheetsHealth?.runs?.running ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="Stale running">{sheetsHealth?.runs?.staleRunning ?? '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </Space>
  );

  const renderAccounts = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="Акаунти Google Ads">
        <Row gutter={12} style={{ marginBottom: 10 }}>
          <Col xs={24} md={12} lg={9}>
            <Input
              allowClear
              placeholder="Пошук по назві, customer ID або назві листа"
              value={accountsQuery}
              onChange={(event) => setAccountsQuery(event.target.value)}
            />
          </Col>
          <Col xs={24} md={12} lg={6}>
            <Select
              style={{ width: '100%' }}
              value={accountsIngestionFilter}
              onChange={(value: 'all' | 'enabled' | 'disabled') => setAccountsIngestionFilter(value)}
              options={[
                { value: 'all', label: 'Усі акаунти' },
                { value: 'enabled', label: 'Лише з увімкненим ingestion' },
                { value: 'disabled', label: 'Лише з вимкненим ingestion' }
              ]}
            />
          </Col>
          <Col xs={24} md={12} lg={6}>
            <Select
              style={{ width: '100%' }}
              value={accountsStatusFilter}
              onChange={(value: 'all' | 'active' | 'inactive') => setAccountsStatusFilter(value)}
              options={[
                { value: 'active', label: 'Лише активні (ENABLED)' },
                { value: 'inactive', label: 'Лише неактивні' },
                { value: 'all', label: 'Усі статуси Google' }
              ]}
            />
          </Col>
          <Col xs={24} md={24} lg={3}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Text type="secondary">Знайдено: {filteredAccounts.length}</Text>
            </Space>
          </Col>
        </Row>

        <Table
          rowKey="id"
          columns={accountColumns}
          dataSource={filteredAccounts}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 980 }}
        />
      </Card>

      <Drawer
        title={selectedAccount ? `Configure ${selectedAccount.descriptiveName}` : 'Configure Account'}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedDrawerConfigId(null);
        }}
        width={560}
        extra={
          <Space>
            {selectedDrawerConfigId ? (
              <Button danger onClick={() => void handleDeleteConfig()}>
                Delete config
              </Button>
            ) : null}
            <Button onClick={() => handleStartNewConfig()}>New config</Button>
            <Button type="primary" loading={drawerSaving} onClick={() => void handleSaveConfig()}>
              Save
            </Button>
          </Space>
        }
      >
        <Form form={configForm} layout="vertical">
          <Form.Item name="ingestionEnabled" label="Ingestion enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          {selectedAccount ? (
            <Form.Item label="Configs for account">
              <Select
                value={selectedDrawerConfigId ?? '__new__'}
                onChange={handleSelectDrawerConfig}
                options={[
                  ...selectedAccount.sheetConfigs.map((config) => ({
                    value: config.id,
                    label: `${config.sheetName} (${config.dataMode}, ${config.active ? 'active' : 'inactive'})`
                  })),
                  { value: '__new__', label: '+ New config' }
                ]}
              />
            </Form.Item>
          ) : null}

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="spreadsheetId" label="Spreadsheet ID">
                <Input placeholder="1abc..." />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sheetName" label="Sheet name">
                <Input placeholder="Report" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="active" label="Config active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Write mode"
                extra="Режим зафіксований: UPSERT оновлює рядок за ключем date + customer_id + campaign_id і не дає дублювати дані."
              >
                <Input value="UPSERT" disabled />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="dataMode" label="Data mode">
                <Select
                  options={[
                    { value: 'CAMPAIGN', label: 'CAMPAIGN' },
                    { value: 'DAILY_TOTAL', label: 'DAILY_TOTAL' }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="columnMode" label="Column mode">
                <Select
                  options={[
                    { value: 'ALL', label: 'ALL' },
                    { value: 'MANUAL', label: 'MANUAL' }
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item noStyle shouldUpdate={(prev, next) => prev.columnMode !== next.columnMode}>
            {({ getFieldValue }) => {
              const isManualMode = getFieldValue('columnMode') === 'MANUAL';

              return (
                <Form.Item
                  name="selectedColumns"
                  label="Поля для вивантаження"
                  extra={
                    isManualMode
                      ? 'У режимі MANUAL поля date, customer_id, campaign_id додаються автоматично.'
                      : 'У режимі ALL будуть вивантажені всі доступні поля.'
                  }
                  rules={[
                    {
                      validator: async (_rule, value) => {
                        if (!isManualMode) {
                          return;
                        }

                        const selected = normalizeStringArray(value);
                        if (selected.length === 0) {
                          throw new Error('Для режиму MANUAL обери хоча б одне поле.');
                        }
                      }
                    }
                  ]}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={exportColumnOptions}
                    placeholder={
                      isManualMode ? 'Обери колонки для Google Sheets' : 'Column mode = ALL (використовуються всі поля)'
                    }
                    disabled={!isManualMode}
                    maxTagCount="responsive"
                  />
                </Form.Item>
              );
            }}
          </Form.Item>

          <Form.Item
            name="campaignStatuses"
            label="Campaign statuses filter (optional)"
            extra="Порожньо = без фільтра, будуть взяті всі статуси кампаній із БД."
          >
            <Select
              mode="tags"
              allowClear
              tokenSeparators={[',', ' ']}
              options={campaignStatusOptions}
              placeholder="ENABLED, PAUSED, REMOVED"
              maxTagCount="responsive"
            />
          </Form.Item>
        </Form>
      </Drawer>
    </Space>
  );

  const renderIngestion = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="Автоматичне завантаження з Google Ads (щодня за вчора)">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={12}>
            <Space direction="vertical" size={2}>
              <Text>
                Статус:{' '}
                {schedulerHealth?.settings?.ingestionEnabled ? (
                  <Tag color="success">Увімкнено</Tag>
                ) : (
                  <Tag color="default">Вимкнено</Tag>
                )}
              </Text>
              <Text type="secondary">
                Час запуску: {formatTimeOfDay(schedulerHealth?.settings?.ingestionHour, schedulerHealth?.settings?.ingestionMinute)} (
                {schedulerHealth?.settings?.timezone ?? 'Europe/Kyiv'})
              </Text>
            </Space>
          </Col>
          <Col xs={24} md={12}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Switch
                checked={Boolean(schedulerHealth?.settings?.ingestionEnabled)}
                loading={autoIngestionSaving}
                onChange={(value) => void handleToggleAutoIngestion(value)}
              />
              <Text>{schedulerHealth?.settings?.ingestionEnabled ? 'Авто ON' : 'Авто OFF'}</Text>
            </Space>
          </Col>
        </Row>
        <Text type="secondary">
          Коли увімкнено: система щодня автоматично тягне в БД дані за вчорашню дату.
        </Text>
      </Card>

      <Card title="Статус поточного оновлення ingestion">
        {currentIngestionRun ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message={`Запуск активний: ${formatDateOnly(currentIngestionRun.dateFrom)} -> ${formatDateOnly(currentIngestionRun.dateTo)} (${currentIngestionRun.id})`}
              description={`Початок: ${formatDate(currentIngestionRun.startedAt)}. Джерело: ${
                currentIngestionRun.triggerSource === 'SCHEDULER' ? 'Автоматично (cron)' : 'Ручний запуск'
              }.`}
            />
            <Progress percent={currentIngestionProgressPercent} status="active" />
            <Space wrap>
              <Tag color="processing">Оброблено акаунтів: {currentIngestionRun.processedAccounts}</Tag>
              <Tag>Всього акаунтів: {currentIngestionRun.totalAccounts}</Tag>
              <Tag color="success">Успішно акаунтів: {currentIngestionRun.successAccounts}</Tag>
              <Tag color="warning">Пропущено акаунтів: {currentIngestionRun.skippedAccounts}</Tag>
              <Tag color="error">Помилки акаунтів: {currentIngestionRun.failedAccounts}</Tag>
              <Tag>Рядків у БД: {currentIngestionRun.rowsUpserted}</Tag>
            </Space>
          </Space>
        ) : (
          <Alert
            type={ingestionSubmitting ? 'warning' : 'success'}
            showIcon
            message={ingestionSubmitting ? 'Запуск ініційовано, очікуємо старт...' : 'Зараз активного запуску немає.'}
            description={
              ingestionSubmitting
                ? 'Якщо бекенд прийняв запуск, рядок RUNNING зʼявиться в таблиці нижче за кілька секунд.'
                : 'Після натискання кнопки ручного запуску тут зʼявиться прогрес.'
            }
          />
        )}
      </Card>

      <Card title="Ручне завантаження в БД (разовий запуск)">
        <Text type="secondary">
          Обери період `Від` {'->'} `До`. Для одного дня постав однакову дату в обох полях.
        </Text>
        <Form
          form={ingestionForm}
          layout="vertical"
          initialValues={{
            enabledOnly: true,
            takeAccounts: 5000,
            batchSize: 100
          }}
        >
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                name="dateFrom"
                label="Період від"
                rules={[{ required: true, message: 'Оберіть дату початку періоду.' }]}
              >
                <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="dateTo"
                label="Період до"
                rules={[{ required: true, message: 'Оберіть дату завершення періоду.' }]}
              >
                <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="accountId" label="Акаунт (опційно, лише активні)">
                <Select allowClear showSearch options={activeAccountOptions} optionFilterProp="label" />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="takeAccounts" label="Ліміт акаунтів">
                <InputNumber min={1} max={20000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="batchSize" label="Розмір пакета">
                <InputNumber min={10} max={500} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="enabledOnly" label="Лише з увімкненим ingestion" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Space>
            <Button
              type="primary"
              icon={<DatabaseOutlined />}
              loading={ingestionSubmitting}
              onClick={() => void handleRunIngestion()}
            >
              Запустити ручне завантаження
            </Button>
            <Button disabled={ingestionSubmitting} onClick={() => void handlePreflight()}>
              Перевірити перед запуском
            </Button>
          </Space>
        </Form>
      </Card>

      <Card title="Історія запусків ingestion">
        <Table rowKey="id" columns={ingestionColumns} dataSource={ingestionRuns} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer
        title={
          selectedIngestionRunDetails
            ? `Деталі запуску: ${formatDateOnly(selectedIngestionRunDetails.dateFrom)} -> ${formatDateOnly(
                selectedIngestionRunDetails.dateTo
              )}`
            : 'Деталі запуску ingestion'
        }
        open={ingestionRunDrawerOpen}
        onClose={() => {
          setIngestionRunDrawerOpen(false);
          setSelectedIngestionRunDetails(null);
        }}
        width={980}
      >
        <Spin spinning={ingestionRunDrawerLoading}>
          {selectedIngestionRunDetails ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Space wrap>
                <Tag color="processing">Оброблено: {selectedIngestionRunDetails.processedAccounts}</Tag>
                <Tag>Всього: {selectedIngestionRunDetails.totalAccounts}</Tag>
                <Tag color="success">Успішно: {selectedIngestionRunDetails.successAccounts}</Tag>
                <Tag color="warning">Пропущено: {selectedIngestionRunDetails.skippedAccounts}</Tag>
                <Tag color="error">Помилки: {selectedIngestionRunDetails.failedAccounts}</Tag>
              </Space>
              {selectedIngestionRunDetails.errorSummary ? (
                <Alert type="error" showIcon message="Загальна помилка запуску" description={selectedIngestionRunDetails.errorSummary} />
              ) : null}
              {selectedIngestionFailedAccountRuns.length > 0 ? (
                <Table
                  rowKey="id"
                  columns={ingestionRunErrorColumns}
                  dataSource={selectedIngestionFailedAccountRuns}
                  pagination={{ pageSize: 8 }}
                  scroll={{ x: 900 }}
                />
              ) : (
                <Alert
                  type="success"
                  showIcon
                  message="Для цього запуску помилок по акаунтах не зафіксовано."
                  description="Якщо були пропуски, це зазвичай означає, що в акаунті за дату не було рядків кампаній."
                />
              )}
            </Space>
          ) : null}
        </Spin>
      </Drawer>
    </Space>
  );

  const renderSheets = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="Авто-конфіг у цьому модулі не редагується">
        <Alert
          type="info"
          showIcon
          message="Автоматичний конфіг експорту налаштовується тільки на рівні акаунту."
          description="Відкрий вкладку «Акаунти», натисни «Налаштувати» біля потрібного акаунта і збережи там spreadsheet/sheet/поля/режими для автоекспорту."
        />
        <Space style={{ marginTop: 12 }} wrap>
          <Button onClick={() => setActiveMenu('accounts')}>Перейти до Акаунтів</Button>
          <Text type="secondary">
            Статус автоекспорту (scheduler): {schedulerHealth?.settings?.sheetsEnabled ? 'Увімкнено' : 'Вимкнено'}
          </Text>
        </Space>
      </Card>

      <Card title="Ручний експорт у Sheets (за період)">
        <Text type="secondary">
          Крок 1: обери акаунт. Крок 2: задай період `Від` {'->'} `До`. Крок 3: задай куди і які поля вивантажувати.
          Цей запуск разовий і не змінює авто-конфіг акаунта.
        </Text>
        <Form
          form={sheetRunForm}
          layout="vertical"
          initialValues={{
            writeMode: 'UPSERT',
            dataMode: 'CAMPAIGN',
            columnMode: 'ALL'
          }}
        >
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item
                name="accountId"
                label="Акаунт"
                rules={[{ required: true, message: 'Оберіть акаунт.' }]}
              >
                <Select
                  allowClear
                  showSearch
                  options={activeAccountOptions}
                  optionFilterProp="label"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="dateFrom"
                label="Період від"
                rules={[{ required: true, message: 'Оберіть дату початку.' }]}
              >
                <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item
                name="dateTo"
                label="Період до"
                rules={[{ required: true, message: 'Оберіть дату завершення.' }]}
              >
                <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                name="spreadsheetId"
                label="Spreadsheet ID"
                rules={[{ required: true, message: 'Вкажіть Spreadsheet ID.' }]}
              >
                <Input placeholder="1abc..." />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="sheetName"
                label="Sheet name"
                rules={[{ required: true, message: 'Вкажіть назву листа.' }]}
              >
                <Input placeholder="Report" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item
                label="Write mode"
                extra="Режим зафіксований: UPSERT шукає рядок за date + customer_id + campaign_id. Ці колонки мають залишатися у листі."
              >
                <Input value="UPSERT" disabled />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="dataMode" label="Data mode">
                <Select
                  options={[
                    { value: 'CAMPAIGN', label: 'CAMPAIGN' },
                    { value: 'DAILY_TOTAL', label: 'DAILY_TOTAL' }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="columnMode" label="Column mode">
                <Select
                  options={[
                    { value: 'ALL', label: 'ALL' },
                    { value: 'MANUAL', label: 'MANUAL' }
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item
                name="selectedColumns"
                label="Поля для вивантаження"
                extra={
                  sheetFormColumnMode === 'ALL'
                    ? 'У режимі ALL будуть вивантажені всі доступні поля.'
                    : 'У режимі MANUAL поля date, customer_id, campaign_id додаються автоматично.'
                }
              >
                <Select
                  mode="multiple"
                  allowClear
                  options={exportColumnOptions}
                  placeholder="Оберіть поля"
                  maxTagCount="responsive"
                  disabled={sheetFormColumnMode === 'ALL'}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="campaignStatuses"
                label="Статуси кампаній (опційно)"
                extra="Порожньо = без фільтра за статусом."
              >
                <Select
                  mode="tags"
                  allowClear
                  tokenSeparators={[',', ' ']}
                  options={campaignStatusOptions}
                  placeholder="ENABLED, PAUSED"
                  maxTagCount="responsive"
                />
              </Form.Item>
            </Col>
          </Row>

          {currentManualRangeRun ? (
            <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
              <Alert
                type="info"
                showIcon
                message={`Виконую ручний експорт на бекенді: ${currentManualRangeRun.completedDays}/${currentManualRangeRun.totalDays} днів`}
                description={
                  `Період: ${formatDateOnly(currentManualRangeRun.dateFrom)} -> ${formatDateOnly(currentManualRangeRun.dateTo)}`
                }
              />
              <Progress percent={currentManualRangeProgressPercent} status="active" />
            </Space>
          ) : null}

          <Space wrap>
            <Button
              type="primary"
              loading={sheetRunSubmitting}
              onClick={() => void handleRunSheetsManualRange()}
            >
              Запустити ручний експорт за період
            </Button>
          </Space>
        </Form>
      </Card>

      <Card title="Фонові запуски ручного експорту за період">
        <Table
          rowKey="id"
          columns={sheetManualRangeRunColumns}
          dataSource={sheetManualRangeRuns}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1100 }}
        />
      </Card>

      <Card title="Історія запусків експорту в Sheets">
        <Table
          rowKey="id"
          columns={sheetRunColumns}
          dataSource={sheetRuns}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1200 }}
        />
      </Card>

      <Card title="Стан Sheets Export">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Активні конфіги">{sheetsHealth?.configs?.active ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Запуски RUNNING">{sheetsHealth?.runs?.running ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Stale RUNNING">{sheetsHealth?.runs?.staleRunning ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Спроби scheduler за вчора">
            {sheetsHealth?.runs?.schedulerAttemptsForYesterday
              ? JSON.stringify(sheetsHealth.runs.schedulerAttemptsForYesterday)
              : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Drawer
        title={
          selectedManualRangeRun
            ? `Ручний експорт за період: ${formatDateOnly(selectedManualRangeRun.dateFrom)} -> ${formatDateOnly(
                selectedManualRangeRun.dateTo
              )}`
            : 'Деталі ручного експорту'
        }
        open={manualRangeRunDrawerOpen}
        onClose={() => {
          setManualRangeRunDrawerOpen(false);
          setSelectedManualRangeRun(null);
        }}
        width={1080}
      >
        <Spin spinning={manualRangeRunDrawerLoading}>
          {selectedManualRangeRun ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Space wrap>
                <Tag color="processing">Виконано днів: {selectedManualRangeRun.completedDays}</Tag>
                <Tag>Всього днів: {selectedManualRangeRun.totalDays}</Tag>
                <Tag color="success">Успішно днів: {selectedManualRangeRun.successDays}</Tag>
                <Tag color="error">Помилки днів: {selectedManualRangeRun.failedDays}</Tag>
                <Tag>{selectedManualRangeRun.writeMode}</Tag>
                <Tag>{selectedManualRangeRun.dataMode}</Tag>
              </Space>
              {selectedManualRangeRun.errorSummary ? (
                <Alert type="error" showIcon message="Останні помилки" description={selectedManualRangeRun.errorSummary} />
              ) : null}
              <Table
                rowKey="id"
                columns={sheetManualRangeRunDayColumns}
                dataSource={selectedManualRangeRun.dayRuns ?? []}
                pagination={{ pageSize: 10 }}
                scroll={{ x: 1000 }}
              />
            </Space>
          ) : null}
        </Spin>
      </Drawer>
    </Space>
  );

  const renderScheduler = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="Scheduler Settings">
        <Form form={schedulerForm} layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="timezone" label="Timezone" rules={[{ required: true }]}>
                <Input placeholder="Europe/Kyiv" />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="ingestionEnabled" label="Ingestion enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item name="sheetsEnabled" label="Sheets enabled" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Title level={5}>Ingestion cron</Title>
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item name="ingestionHour" label="Hour">
                <InputNumber min={0} max={23} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="ingestionMinute" label="Minute">
                <InputNumber min={0} max={59} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item name="ingestionMaxDailyAttempts" label="Max attempts/day">
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item name="ingestionRetryDelayMin" label="Retry delay (min)">
                <InputNumber min={1} max={180} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="ingestionBatchSize" label="Batch">
                <InputNumber min={10} max={500} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="ingestionMaxAccounts" label="Max accounts">
                <InputNumber min={1} max={20000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Title level={5}>Sheets cron</Title>
          <Row gutter={12}>
            <Col xs={12} md={4}>
              <Form.Item name="sheetsHour" label="Hour">
                <InputNumber min={0} max={23} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="sheetsMinute" label="Minute">
                <InputNumber min={0} max={59} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item name="sheetsMaxDailyAttempts" label="Max attempts/day">
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={5}>
              <Form.Item name="sheetsRetryDelayMin" label="Retry delay (min)">
                <InputNumber min={1} max={180} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="sheetsMaxConfigsPerTick" label="Max configs/tick">
                <InputNumber min={1} max={2000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Button type="primary" icon={<SettingOutlined />} onClick={() => void handleSaveScheduler()}>
            Save scheduler settings
          </Button>
        </Form>
      </Card>

      <Card title="Scheduler Runtime">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Poll seconds">{schedulerHealth?.runtime.pollSeconds ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Catchup days">{schedulerHealth?.runtime.catchupDays ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="Next ingestion at">
            {formatDate(schedulerHealth?.runtime.nextIngestionAt)}
          </Descriptions.Item>
          <Descriptions.Item label="Next sheets at">
            {formatDate(schedulerHealth?.runtime.nextSheetsAt)}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );

  let content = renderOverview();
  if (activeMenu === 'accounts') {
    content = renderAccounts();
  } else if (activeMenu === 'ingestion') {
    content = renderIngestion();
  } else if (activeMenu === 'sheets') {
    content = renderSheets();
  } else if (activeMenu === 'scheduler') {
    content = renderScheduler();
  }

  if (authChecking) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#3b82f6',
            colorInfo: '#3b82f6',
            borderRadius: 14,
            fontFamily: 'Manrope, system-ui, sans-serif',
            colorBgLayout: '#f3f6fb',
            colorBorder: '#e3e8f0',
            colorText: '#1f2937',
            colorTextSecondary: '#64748b'
          }
        }}
      >
        <AntApp>
          <Layout className="app-shell">
            <Content className="app-content">
              <Card style={{ maxWidth: 520, margin: '120px auto' }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Title level={4} style={{ marginBottom: 0 }}>
                    Перевірка сесії
                  </Title>
                  <Spin />
                </Space>
              </Card>
            </Content>
          </Layout>
        </AntApp>
      </ConfigProvider>
    );
  }

  if (!authSession) {
    return (
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#3b82f6',
            colorInfo: '#3b82f6',
            borderRadius: 14,
            fontFamily: 'Manrope, system-ui, sans-serif',
            colorBgLayout: '#f3f6fb',
            colorBorder: '#e3e8f0',
            colorText: '#1f2937',
            colorTextSecondary: '#64748b'
          }
        }}
      >
        <AntApp>
          <Layout className="app-shell">
            <Content className="app-content">
              <Card title="Вхід у сервіс" style={{ maxWidth: 620, margin: '120px auto' }}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Text>Доступ дозволено тільки для авторизованого Google-акаунта з allowlist.</Text>
                  <Button type="primary" icon={<ApiOutlined />} onClick={() => void handleLogin()}>
                    Увійти через Google
                  </Button>
                  <Text type="secondary">
                    Після входу сесія діє обмежений час (за замовчуванням 6 днів), далі потрібна повторна авторизація.
                  </Text>
                </Space>
              </Card>
            </Content>
          </Layout>
        </AntApp>
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3b82f6',
          colorInfo: '#3b82f6',
          borderRadius: 14,
          fontFamily: 'Manrope, system-ui, sans-serif',
          colorBgLayout: '#f3f6fb',
          colorBorder: '#e3e8f0',
          colorText: '#1f2937',
          colorTextSecondary: '#64748b'
        }
      }}
    >
      <AntApp>
        <Layout className="app-shell">
          <Sider
            collapsible
            collapsed={collapsed}
            onCollapse={setCollapsed}
            breakpoint="lg"
            onBreakpoint={(broken) => setCollapsed(broken)}
            className="app-sider"
            width={250}
          >
            <div className="brand-block">
              <Title level={4} style={{ margin: 0, color: '#f5fff8' }}>
                Ads MVP
              </Title>
              {!collapsed ? <Text className="brand-sub">Control Center</Text> : null}
            </div>
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[activeMenu]}
              openKeys={collapsed ? [] : openMenuKeys}
              onOpenChange={(keys) => setOpenMenuKeys(keys as string[])}
              items={menuItems}
              onSelect={(info) => setActiveMenu(info.key as MenuKey)}
            />
          </Sider>

          <Layout>
            <Header className="app-header">
              <div className="header-top">
                <div>
                  <Title level={3} style={{ margin: 0 }}>
                    {menuLabelByKey[activeMenu]}
                  </Title>
                  <Text type="secondary">{menuDescriptionByKey[activeMenu]}</Text>
                </div>
                <Space wrap>
                  <Text type="secondary">{authSession.email}</Text>
                  <Text type="secondary">
                    Session до: {formatDate(authSession.expiresAt)} ({authSession.expiresInDays} дн.)
                  </Text>
                  <Button onClick={() => void handleLogout()}>Logout</Button>
                  <Button icon={<ReloadOutlined />} onClick={() => void refreshAll()}>
                    Reload
                  </Button>
                </Space>
              </div>
              {requestError ? <Text type="danger">{requestError}</Text> : null}
            </Header>

            <Content className="app-content">
              <Spin spinning={loading}>{content}</Spin>
              <Card title="Latest Response" style={{ marginTop: 16 }}>
                <pre className="output-pre">{requestOutput}</pre>
              </Card>
            </Content>
          </Layout>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}
