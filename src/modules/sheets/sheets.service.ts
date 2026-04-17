import axios from 'axios';
import crypto from 'crypto';
import {
  SheetColumnMode,
  SheetDataMode,
  SheetRunStatus,
  SheetWriteMode,
  TriggerSource,
  type Prisma
} from '@prisma/client';
import { env } from '../../config/env.js';
import { isGoogleSheetsAddSheetAlreadyExistsError } from '../../lib/google-sheets-errors.js';
import {
  formatGoogleSheetsQuotaMessage,
  GoogleSheetsQuotaExhaustedError,
  parseGoogleSheetsQuotaExhaustedMeta,
  resolveGoogleSheetsQuotaRetryDelayMs
} from '../../lib/google-sheets-quota.js';
import { ApiError } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { getDefaultYesterdayRunDate, getUtcDayWindow, parseDateOnlyToUtcDayStart, toDateOnlyString } from '../../lib/timezone.js';
import { getGoogleOAuthRuntimeToken } from '../google/google.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SHEETS_BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_EXPORT_START_LOCK_PREFIX = 'sheet-export-start';
const MAX_SHEET_CONFIGS_PER_ACCOUNT = 25;

const EXPORT_COLUMN_KEYS = [
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

const UPSERT_ROW_KEY_COLUMNS = ['date', 'customer_id', 'campaign_id'] as const;
const NUMERIC_EXPORT_COLUMNS = new Set<SheetExportColumnKey>([
  'impressions',
  'clicks',
  'ctr_percent',
  'average_cpc',
  'cost',
  'conversions',
  'cost_per_conversion',
  'conversion_value',
  'conversion_value_per_cost'
]);

export type SheetExportColumnKey = (typeof EXPORT_COLUMN_KEYS)[number];

export const SHEET_EXPORT_AVAILABLE_COLUMNS = Array.from(EXPORT_COLUMN_KEYS);
export const REQUIRED_UPSERT_EXPORT_COLUMNS = Array.from(UPSERT_ROW_KEY_COLUMNS);

type FactWithAccount = Prisma.CampaignDailyFactGetPayload<{
  include: {
    adsAccount: {
      select: {
        id: true;
        customerId: true;
        descriptiveName: true;
      };
    };
  };
}>;

type RowValueMap = Record<SheetExportColumnKey, string | number>;

type PreparedExportRow = {
  rowKey: string;
  rowHash: string;
  values: Array<string | number>;
};

type PreparedExportRowsPayload = {
  rows: PreparedExportRow[];
  selectedColumns: SheetExportColumnKey[];
};

type SheetCellValue = string | number | boolean | null;

type SheetGetValuesResponse = {
  values?: SheetCellValue[][];
};

type SheetAppendResponse = {
  updates?: {
    updatedRange?: string;
  };
};

type ManualSheetRangeWindow = {
  dateFrom: Date;
  dateTo: Date;
  runDates: Date[];
  totalDays: number;
};

const manualRangeRunQueue: string[] = [];
const manualRangeRunQueueSet = new Set<string>();
let manualRangeRunWorkerBusy = false;

function toErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;

    if (status === 404) {
      return 'Таблицю не знайдено (404). Перевірте Spreadsheet ID та доступ Google-акаунта до таблиці.';
    }

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

async function withSheetsRetries<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= env.GOOGLE_SHEETS_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const quotaMeta = parseGoogleSheetsQuotaExhaustedMeta(error);
      if (attempt === env.GOOGLE_SHEETS_RETRY_ATTEMPTS || !isRetryable(error)) {
        if (quotaMeta) {
          throw new GoogleSheetsQuotaExhaustedError(quotaMeta);
        }

        throw error;
      }

      const baseBackoff =
        env.GOOGLE_SHEETS_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
      const backoff = quotaMeta ? resolveGoogleSheetsQuotaRetryDelayMs(quotaMeta, baseBackoff) : baseBackoff;
      await sleep(backoff);
    }
  }

  throw lastError;
}

function normalizeSpreadsheetId(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 10) {
    throw new ApiError(400, 'spreadsheetId must be at least 10 characters.');
  }
  return normalized;
}

function normalizeSheetName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw new ApiError(400, 'sheetName must contain 1-120 characters.');
  }
  return normalized;
}

function parseCsvList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toCsvList(values: string[]): string {
  return values.join(',');
}

function enumerateDateRange(window: { dateFrom: Date; dateTo: Date }): Date[] {
  const values: Date[] = [];
  const cursor = new Date(window.dateFrom.getTime());

  while (cursor.getTime() <= window.dateTo.getTime()) {
    values.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return values;
}

function buildManualRangeWindow(params: { dateFrom: string; dateTo: string }): ManualSheetRangeWindow {
  const dateFrom = parseDateOnlyToUtcDayStart(params.dateFrom);
  const dateTo = parseDateOnlyToUtcDayStart(params.dateTo);

  if (dateFrom.getTime() > dateTo.getTime()) {
    throw new ApiError(400, 'dateFrom must be less than or equal to dateTo.');
  }

  const totalDays = Math.floor((dateTo.getTime() - dateFrom.getTime()) / DAY_MS) + 1;
  if (totalDays > env.SHEETS_MANUAL_MAX_RANGE_DAYS) {
    throw new ApiError(
      400,
      `Requested date range is too large (${totalDays} day(s)). Max allowed: ${env.SHEETS_MANUAL_MAX_RANGE_DAYS} day(s).`
    );
  }

  return {
    dateFrom,
    dateTo,
    totalDays,
    runDates: enumerateDateRange({ dateFrom, dateTo })
  };
}

function normalizeSelectedColumns(input: string[] | undefined, mode: SheetColumnMode): SheetExportColumnKey[] {
  if (mode === SheetColumnMode.ALL) {
    return Array.from(EXPORT_COLUMN_KEYS);
  }

  const candidate = input ?? [];
  const normalized: SheetExportColumnKey[] = [];
  const seen = new Set<string>();

  for (const item of candidate) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }

    if ((EXPORT_COLUMN_KEYS as readonly string[]).includes(key)) {
      normalized.push(key as SheetExportColumnKey);
      seen.add(key);
    }
  }

  if (normalized.length === 0) {
    throw new ApiError(400, 'selectedColumns must contain at least one valid column in MANUAL mode.');
  }

  return normalized;
}

function normalizeCampaignStatuses(input: string[] | undefined): string[] {
  if (!input || input.length === 0) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of input) {
    const normalized = item.trim().toUpperCase();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function resolveForcedWriteMode(_value?: SheetWriteMode | null): SheetWriteMode {
  return SheetWriteMode.UPSERT;
}

function ensureRequiredUpsertColumns(selectedColumns: SheetExportColumnKey[]): SheetExportColumnKey[] {
  const result: SheetExportColumnKey[] = [];
  const seen = new Set<string>();

  for (const column of REQUIRED_UPSERT_EXPORT_COLUMNS) {
    if (!seen.has(column)) {
      result.push(column);
      seen.add(column);
    }
  }

  for (const column of selectedColumns) {
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

function areStringSetsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function toColumnLetters(columnNumber: number): string {
  if (!Number.isInteger(columnNumber) || columnNumber <= 0) {
    throw new ApiError(500, 'Invalid sheet column number.');
  }

  let value = columnNumber;
  let result = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }

  return result;
}

function escapeSheetName(value: string): string {
  return value.replace(/'/g, "''");
}

function toA1Range(sheetName: string, start: string, end?: string): string {
  const escaped = `'${escapeSheetName(sheetName)}'`;
  return end ? `${escaped}!${start}:${end}` : `${escaped}!${start}`;
}

function toSheetsUrl(spreadsheetId: string, range: string, suffix = ''): string {
  return `${SHEETS_BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}${suffix}`;
}

function hashRow(values: Array<string | number>): string {
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeOptionalText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : '';
}

function pickRowValues(map: RowValueMap, selectedColumns: SheetExportColumnKey[]): Array<string | number> {
  return selectedColumns.map((column) => map[column]);
}

function hasUpsertRowKeyColumns(headers: SheetExportColumnKey[]): boolean {
  return UPSERT_ROW_KEY_COLUMNS.every((column) => headers.includes(column));
}

function normalizeSheetCellValue(raw: SheetCellValue | undefined, column: SheetExportColumnKey): string | number {
  if (raw === null || raw === undefined) {
    return '';
  }

  if (typeof raw === 'number') {
    return NUMERIC_EXPORT_COLUMNS.has(column) ? roundMetric(raw) : String(raw);
  }

  if (typeof raw === 'boolean') {
    return raw ? 'TRUE' : 'FALSE';
  }

  const normalized = normalizeOptionalText(raw);
  if (!NUMERIC_EXPORT_COLUMNS.has(column) || normalized.length === 0) {
    return normalized;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundMetric(parsed) : normalized;
}

function buildRowKeyFromValues(values: Array<string | number>, headers: SheetExportColumnKey[]): string | null {
  if (!hasUpsertRowKeyColumns(headers)) {
    return null;
  }

  const dateIndex = headers.indexOf('date');
  const customerIdIndex = headers.indexOf('customer_id');
  const campaignIdIndex = headers.indexOf('campaign_id');

  const dateValue = normalizeOptionalText(String(values[dateIndex] ?? ''));
  const customerIdValue = normalizeOptionalText(String(values[customerIdIndex] ?? ''));
  const campaignIdValue = normalizeOptionalText(String(values[campaignIdIndex] ?? ''));

  if (!dateValue || !customerIdValue || !campaignIdValue) {
    return null;
  }

  return `${dateValue}|${customerIdValue}|${campaignIdValue}`;
}

function parseAppendedRowIndex(updatedRange?: string): number | null {
  if (!updatedRange) {
    return null;
  }

  const matched = updatedRange.match(/![A-Z]+(\d+):[A-Z]+\d+$/i);
  if (!matched) {
    return null;
  }

  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureSheetsScope(scopes: string[]): void {
  const hasScope = scopes.some((scope) => scope.trim() === env.GOOGLE_SHEETS_REQUIRED_SCOPE);
  if (!hasScope) {
    throw new ApiError(
      400,
      'Google OAuth token has no Google Sheets scope. Reconnect OAuth with Sheets scope.'
    );
  }
}

async function ensureAccountExportable(accountId: string) {
  const account = await prisma.adsAccount.findUnique({
    where: {
      id: accountId
    },
    select: {
      id: true,
      isInMcc: true,
      isManager: true,
      googleStatus: true
    }
  });

  if (!account) {
    throw new ApiError(404, 'Google Ads account not found.');
  }

  if (!account.isInMcc || account.isManager || account.googleStatus === 'CLOSED') {
    throw new ApiError(400, 'Google Ads account is not eligible for export.');
  }

  return account;
}

function isAlreadyExistsSheetError(error: unknown): boolean {
  return axios.isAxiosError(error) && isGoogleSheetsAddSheetAlreadyExistsError(error);
}

async function createSheetIfMissing(params: {
  spreadsheetId: string;
  sheetName: string;
  accessToken: string;
}): Promise<void> {
  const url = `${SHEETS_BASE_URL}/${encodeURIComponent(params.spreadsheetId)}:batchUpdate`;

  try {
    await withSheetsRetries(() =>
      axios.post(
        url,
        {
          requests: [
            {
              addSheet: {
                properties: {
                  title: params.sheetName
                }
              }
            }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: env.GOOGLE_SHEETS_HTTP_TIMEOUT_MS
        }
      )
    );
  } catch (error) {
    if (isAlreadyExistsSheetError(error)) {
      return;
    }

    throw error;
  }
}

async function ensureSheetTabExists(params: {
  spreadsheetId: string;
  sheetName: string;
  accessToken: string;
}): Promise<void> {
  // Avoid extra read quota calls; addSheet is idempotent for our flow ("already exists" is swallowed).
  await createSheetIfMissing(params);
}

async function fetchSheetValues(params: {
  spreadsheetId: string;
  range: string;
  accessToken: string;
  valueRenderOption?: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE';
}): Promise<SheetCellValue[][]> {
  const suffix = params.valueRenderOption ? `?valueRenderOption=${params.valueRenderOption}` : '';

  const response = await withSheetsRetries(() =>
    axios.get<SheetGetValuesResponse>(toSheetsUrl(params.spreadsheetId, params.range, suffix), {
      headers: {
        Authorization: `Bearer ${params.accessToken}`
      },
      timeout: env.GOOGLE_SHEETS_HTTP_TIMEOUT_MS
    })
  );

  return response.data.values ?? [];
}

async function updateRangeValues(params: {
  spreadsheetId: string;
  range: string;
  values: Array<Array<string | number>>;
  accessToken: string;
}): Promise<void> {
  await withSheetsRetries(() =>
    axios.put(
      toSheetsUrl(params.spreadsheetId, params.range, '?valueInputOption=RAW'),
      {
        range: params.range,
        majorDimension: 'ROWS',
        values: params.values
      },
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: env.GOOGLE_SHEETS_HTTP_TIMEOUT_MS
      }
    )
  );
}

async function appendValues(params: {
  spreadsheetId: string;
  sheetName: string;
  values: Array<string | number>;
  accessToken: string;
}): Promise<number | null> {
  const range = toA1Range(params.sheetName, 'A1');

  const response = await withSheetsRetries(() =>
    axios.post<SheetAppendResponse>(
      toSheetsUrl(
        params.spreadsheetId,
        range,
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false'
      ),
      {
        majorDimension: 'ROWS',
        values: [params.values]
      },
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: env.GOOGLE_SHEETS_HTTP_TIMEOUT_MS
      }
    )
  );

  return parseAppendedRowIndex(response.data.updates?.updatedRange);
}

async function ensureHeader(params: {
  spreadsheetId: string;
  sheetName: string;
  accessToken: string;
  headers: SheetExportColumnKey[];
}): Promise<void> {
  // Always set header row explicitly; this removes one read call per export run.
  const range = toA1Range(params.sheetName, 'A1', `${toColumnLetters(params.headers.length)}1`);

  await updateRangeValues({
    spreadsheetId: params.spreadsheetId,
    range,
    values: [Array.from(params.headers)],
    accessToken: params.accessToken
  });
}

async function loadExistingSheetRowsForUpsert(params: {
  spreadsheetId: string;
  sheetName: string;
  accessToken: string;
  headers: SheetExportColumnKey[];
}): Promise<Map<string, { rowHash: string; rowIndex: number }>> {
  if (!hasUpsertRowKeyColumns(params.headers)) {
    return new Map();
  }

  const range = toA1Range(params.sheetName, 'A1', `${toColumnLetters(params.headers.length)}1000000`);
  const values = await fetchSheetValues({
    spreadsheetId: params.spreadsheetId,
    range,
    accessToken: params.accessToken,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });

  if (values.length <= 1) {
    return new Map();
  }

  const headerRow = (values[0] ?? []).map((cell) => normalizeOptionalText(cell === null || cell === undefined ? '' : String(cell)));
  const isCompatibleHeader = params.headers.every((header, index) => headerRow[index] === header);
  if (!isCompatibleHeader) {
    return new Map();
  }

  const rowsByKey = new Map<string, { rowHash: string; rowIndex: number }>();

  for (let index = 1; index < values.length; index += 1) {
    const normalizedValues = params.headers.map((header, columnIndex) =>
      normalizeSheetCellValue(values[index]?.[columnIndex], header)
    );
    const rowKey = buildRowKeyFromValues(normalizedValues, params.headers);
    if (!rowKey) {
      continue;
    }

    rowsByKey.set(rowKey, {
      rowHash: hashRow(normalizedValues),
      rowIndex: index + 1
    });
  }

  return rowsByKey;
}

function summarizeText(values: Array<string | null | undefined>): string {
  const normalized = values.map((value) => normalizeOptionalText(value)).filter((value) => value.length > 0);

  if (normalized.length === 0) {
    return '';
  }

  const unique = Array.from(new Set(normalized));
  return unique.length === 1 ? unique[0] : 'MIXED';
}

function buildDailyTotalRow(params: {
  facts: FactWithAccount[];
  runDateText: string;
  selectedColumns: SheetExportColumnKey[];
}): PreparedExportRow | null {
  if (params.facts.length === 0) {
    return null;
  }

  let impressions = 0;
  let clicks = 0;
  let cost = 0;
  let conversions = 0;
  let conversionValue = 0;

  for (const fact of params.facts) {
    impressions += fact.impressions;
    clicks += fact.clicks;
    cost += fact.cost;
    conversions += fact.conversions;
    conversionValue += fact.conversionValue;
  }

  const ctrPercent = impressions > 0 ? roundMetric((clicks / impressions) * 100) : 0;
  const averageCpc = clicks > 0 ? roundMetric(cost / clicks) : 0;
  const costPerConversion = conversions > 0 ? roundMetric(cost / conversions) : 0;
  const conversionValuePerCost = cost > 0 ? roundMetric(conversionValue / cost) : 0;

  const account = params.facts[0].adsAccount;

  const rowValueMap: RowValueMap = {
    date: params.runDateText,
    customer_id: account.customerId,
    account_name: account.descriptiveName,
    campaign_id: 'ALL',
    campaign_name: 'All campaigns',
    campaign_status: 'ALL',
    impressions,
    clicks,
    ctr_percent: ctrPercent,
    average_cpc: averageCpc,
    cost: roundMetric(cost),
    conversions: roundMetric(conversions),
    cost_per_conversion: costPerConversion,
    conversion_value: roundMetric(conversionValue),
    conversion_value_per_cost: conversionValuePerCost,
    final_url_suffix: summarizeText(params.facts.map((fact) => fact.finalUrlSuffix)),
    tracking_url_template: summarizeText(params.facts.map((fact) => fact.trackingUrlTemplate)),
    utm_source: summarizeText(params.facts.map((fact) => fact.utmSource)),
    utm_medium: summarizeText(params.facts.map((fact) => fact.utmMedium)),
    utm_campaign: summarizeText(params.facts.map((fact) => fact.utmCampaign)),
    utm_term: summarizeText(params.facts.map((fact) => fact.utmTerm)),
    utm_content: summarizeText(params.facts.map((fact) => fact.utmContent))
  };

  const values = pickRowValues(rowValueMap, params.selectedColumns);

  return {
    rowKey: `${params.runDateText}|${account.customerId}|ALL`,
    rowHash: hashRow(values),
    values
  };
}

async function prepareRowsForConfig(params: {
  accountId: string;
  runDate: Date;
  dataMode: SheetDataMode;
  campaignStatuses: string[];
  selectedColumns: SheetExportColumnKey[];
  campaignNameSearch?: string;
}): Promise<PreparedExportRowsPayload> {
  const runDateText = toDateOnlyString(params.runDate);
  const window = getUtcDayWindow(params.runDate);
  const nameSearch = params.campaignNameSearch?.trim() ?? '';

  const facts = await prisma.campaignDailyFact.findMany({
    where: {
      adsAccountId: params.accountId,
      factDate: {
        gte: window.start,
        lt: window.end
      },
      campaignStatus: params.campaignStatuses.length > 0 ? { in: params.campaignStatuses } : undefined,
      ...(nameSearch ? { campaignName: { contains: nameSearch, mode: 'insensitive' } } : {})
    },
    include: {
      adsAccount: {
        select: {
          id: true,
          customerId: true,
          descriptiveName: true
        }
      }
    },
    orderBy: [{ customerId: 'asc' }, { campaignId: 'asc' }]
  });

  if (params.dataMode === SheetDataMode.DAILY_TOTAL) {
    const totalRow = buildDailyTotalRow({
      facts,
      runDateText,
      selectedColumns: params.selectedColumns
    });

    return {
      selectedColumns: params.selectedColumns,
      rows: totalRow ? [totalRow] : []
    };
  }

  const rows = facts.map((fact) => {
    const map: RowValueMap = {
      date: runDateText,
      customer_id: fact.customerId,
      account_name: fact.adsAccount.descriptiveName,
      campaign_id: fact.campaignId,
      campaign_name: fact.campaignName,
      campaign_status: fact.campaignStatus,
      impressions: fact.impressions,
      clicks: fact.clicks,
      ctr_percent: fact.ctrPercent,
      average_cpc: fact.averageCpc,
      cost: fact.cost,
      conversions: fact.conversions,
      cost_per_conversion: fact.costPerConversion,
      conversion_value: fact.conversionValue,
      conversion_value_per_cost: fact.conversionValuePerCost,
      final_url_suffix: normalizeOptionalText(fact.finalUrlSuffix),
      tracking_url_template: normalizeOptionalText(fact.trackingUrlTemplate),
      utm_source: normalizeOptionalText(fact.utmSource),
      utm_medium: normalizeOptionalText(fact.utmMedium),
      utm_campaign: normalizeOptionalText(fact.utmCampaign),
      utm_term: normalizeOptionalText(fact.utmTerm),
      utm_content: normalizeOptionalText(fact.utmContent)
    };

    const values = pickRowValues(map, params.selectedColumns);

    return {
      rowKey: `${runDateText}|${fact.customerId}|${fact.campaignId}`,
      rowHash: hashRow(values),
      values
    };
  });

  return {
    selectedColumns: params.selectedColumns,
    rows
  };
}

async function runAppendOrUpsertMode(params: {
  runId: string;
  configId: string;
  spreadsheetId: string;
  sheetName: string;
  accessToken: string;
  headers: SheetExportColumnKey[];
  rows: PreparedExportRow[];
  writeMode: SheetWriteMode;
  persistRowState?: boolean;
  progressRunId?: string;
}) {
  await ensureSheetTabExists({
    spreadsheetId: params.spreadsheetId,
    sheetName: params.sheetName,
    accessToken: params.accessToken
  });

  await ensureHeader({
    spreadsheetId: params.spreadsheetId,
    sheetName: params.sheetName,
    accessToken: params.accessToken,
    headers: params.headers
  });

  const useRowState = params.persistRowState !== false;
  const canBootstrapUpsertFromSheet = params.writeMode === SheetWriteMode.UPSERT && hasUpsertRowKeyColumns(params.headers);
  const effectiveWriteMode =
    params.writeMode === SheetWriteMode.UPSERT && !useRowState && !canBootstrapUpsertFromSheet
      ? SheetWriteMode.APPEND
      : params.writeMode;

  const existingStates = useRowState
    ? await prisma.sheetRowState.findMany({
        where: {
          configId: params.configId,
          rowKey: {
            in: params.rows.map((item) => item.rowKey)
          }
        },
        select: {
          rowKey: true,
          rowHash: true,
          rowIndex: true
        }
      })
    : [];

  const stateByKey = new Map<string, { rowHash: string; rowIndex: number | null }>(
    existingStates.map((item) => [
      item.rowKey,
      {
        rowHash: item.rowHash,
        rowIndex: item.rowIndex
      }
    ])
  );

  // For UPSERT, always use the actual sheet content as the source of truth.
  // This auto-recovers after manual row moves/deletes and avoids stale rowIndex holes.
  const sheetRowsByKey =
    effectiveWriteMode === SheetWriteMode.UPSERT && canBootstrapUpsertFromSheet
      ? await loadExistingSheetRowsForUpsert({
          spreadsheetId: params.spreadsheetId,
          sheetName: params.sheetName,
          accessToken: params.accessToken,
          headers: params.headers
        })
      : new Map<string, { rowHash: string; rowIndex: number }>();

  let rowsWritten = 0;
  let rowsSkipped = 0;
  let rowsFailed = 0;
  const rowErrors: string[] = [];
  let processedRows = 0;

  const flushProgress = async (force = false): Promise<void> => {
    if (!params.progressRunId) {
      return;
    }

    if (!force && processedRows > 0 && processedRows % 25 !== 0) {
      return;
    }

    try {
      await prisma.sheetExportRun.update({
        where: {
          id: params.progressRunId
        },
        data: {
          rowsPrepared: params.rows.length,
          rowsWritten,
          rowsSkipped,
          rowsFailed,
          errorSummary: rowErrors.length > 0 ? truncate(rowErrors.slice(-3).join(' | '), 1500) : null
        }
      });
    } catch {
      // Best-effort heartbeat: do not fail export when progress update fails.
    }
  };

  for (const row of params.rows) {
    const persistedState = stateByKey.get(row.rowKey);
    const existingOnSheet = effectiveWriteMode === SheetWriteMode.UPSERT ? sheetRowsByKey.get(row.rowKey) : null;

    const shouldSkip =
      effectiveWriteMode === SheetWriteMode.UPSERT
        ? Boolean(existingOnSheet && existingOnSheet.rowHash === row.rowHash)
        : Boolean(useRowState && persistedState && persistedState.rowHash === row.rowHash);

    if (shouldSkip) {
      if (
        useRowState &&
        existingOnSheet &&
        (!persistedState ||
          persistedState.rowHash !== existingOnSheet.rowHash ||
          persistedState.rowIndex !== existingOnSheet.rowIndex)
      ) {
        await prisma.sheetRowState.upsert({
          where: {
            configId_rowKey: {
              configId: params.configId,
              rowKey: row.rowKey
            }
          },
          update: {
            rowHash: existingOnSheet.rowHash,
            rowIndex: existingOnSheet.rowIndex,
            lastRunId: params.runId,
            lastExportedAt: new Date()
          },
          create: {
            configId: params.configId,
            rowKey: row.rowKey,
            rowHash: existingOnSheet.rowHash,
            rowIndex: existingOnSheet.rowIndex,
            lastRunId: params.runId,
            lastExportedAt: new Date()
          }
        });
      }

      rowsSkipped += 1;
      processedRows += 1;
      await flushProgress();
      continue;
    }

    try {
      let rowIndex: number | null = null;

      if (effectiveWriteMode === SheetWriteMode.UPSERT && existingOnSheet?.rowIndex) {
        const range = toA1Range(
          params.sheetName,
          `A${existingOnSheet.rowIndex}`,
          `${toColumnLetters(params.headers.length)}${existingOnSheet.rowIndex}`
        );

        await updateRangeValues({
          spreadsheetId: params.spreadsheetId,
          range,
          values: [row.values],
          accessToken: params.accessToken
        });

        rowIndex = existingOnSheet.rowIndex;
      } else {
        rowIndex = await appendValues({
          spreadsheetId: params.spreadsheetId,
          sheetName: params.sheetName,
          values: row.values,
          accessToken: params.accessToken
        });
      }

      if (useRowState) {
        const persistedRowIndex = rowIndex ?? existingOnSheet?.rowIndex ?? persistedState?.rowIndex ?? null;

        await prisma.sheetRowState.upsert({
          where: {
            configId_rowKey: {
              configId: params.configId,
              rowKey: row.rowKey
            }
          },
          update: {
            rowHash: row.rowHash,
            rowIndex: persistedRowIndex,
            lastRunId: params.runId,
            lastExportedAt: new Date()
          },
          create: {
            configId: params.configId,
            rowKey: row.rowKey,
            rowHash: row.rowHash,
            rowIndex: persistedRowIndex,
            lastRunId: params.runId,
            lastExportedAt: new Date()
          }
        });

        stateByKey.set(row.rowKey, {
          rowHash: row.rowHash,
          rowIndex: persistedRowIndex
        });
      }

      if (effectiveWriteMode === SheetWriteMode.UPSERT && rowIndex) {
        sheetRowsByKey.set(row.rowKey, {
          rowHash: row.rowHash,
          rowIndex
        });
      }

      rowsWritten += 1;
    } catch (error) {
      if (error instanceof GoogleSheetsQuotaExhaustedError) {
        rowsFailed += 1;
        rowErrors.push(`[${row.rowKey}] ${truncate(formatGoogleSheetsQuotaMessage(error.meta), 460)}`);
        processedRows += 1;
        await flushProgress(true);
        throw error;
      }

      rowsFailed += 1;
      rowErrors.push(`[${row.rowKey}] ${truncate(toErrorMessage(error), 460)}`);
    }

    processedRows += 1;
    await flushProgress();
  }

  await flushProgress(true);

  return {
    rowsWritten,
    rowsSkipped,
    rowsFailed,
    rowErrors
  };
}

function deriveRunStatus(stats: {
  rowsPrepared: number;
  rowsWritten: number;
  rowsSkipped: number;
  rowsFailed: number;
}): SheetRunStatus {
  if (stats.rowsPrepared === 0) {
    return SheetRunStatus.SKIPPED;
  }

  if (stats.rowsFailed === 0 && stats.rowsWritten === 0 && stats.rowsSkipped === stats.rowsPrepared) {
    return SheetRunStatus.SKIPPED;
  }

  if (stats.rowsFailed === 0) {
    return SheetRunStatus.SUCCESS;
  }

  if (stats.rowsWritten === 0) {
    return SheetRunStatus.FAILED;
  }

  return SheetRunStatus.PARTIAL;
}

function deriveManualRangeRunStatus(params: { totalDays: number; failedDays: number }): SheetRunStatus {
  if (params.totalDays <= 0) {
    return SheetRunStatus.SKIPPED;
  }

  if (params.failedDays <= 0) {
    return SheetRunStatus.SUCCESS;
  }

  if (params.failedDays >= params.totalDays) {
    return SheetRunStatus.FAILED;
  }

  return SheetRunStatus.PARTIAL;
}

function resolveSelectedColumns(config: {
  columnMode: SheetColumnMode;
  selectedColumnsCsv: string;
}): SheetExportColumnKey[] {
  if (config.columnMode === SheetColumnMode.ALL) {
    return Array.from(EXPORT_COLUMN_KEYS);
  }

  return ensureRequiredUpsertColumns(normalizeSelectedColumns(parseCsvList(config.selectedColumnsCsv), SheetColumnMode.MANUAL));
}

function mapSheetExportConfig<T extends {
  selectedColumnsCsv: string;
  campaignStatusesCsv: string;
  writeMode?: SheetWriteMode | null;
  columnMode?: SheetColumnMode | null;
}>(config: T): Omit<T, 'writeMode'> & {
  writeMode: SheetWriteMode;
  selectedColumns: string[];
  campaignStatuses: string[];
} {
  const selectedColumns = parseCsvList(config.selectedColumnsCsv);

  return {
    ...config,
    writeMode: resolveForcedWriteMode(config.writeMode),
    selectedColumns:
      config.columnMode === SheetColumnMode.MANUAL ? ensureRequiredUpsertColumns(selectedColumns as SheetExportColumnKey[]) : selectedColumns,
    campaignStatuses: parseCsvList(config.campaignStatusesCsv)
  };
}

export async function previewSheetExport(params: {
  accountId: string;
  dateFrom: string;
  dateTo: string;
  dataMode?: SheetDataMode;
  columnMode?: SheetColumnMode;
  selectedColumns?: string[];
  campaignStatuses?: string[];
  campaignNameSearch?: string;
  take?: number;
}) {
  const take = Math.min(Math.max(params.take ?? 100, 1), 500);
  const dataMode = params.dataMode ?? SheetDataMode.CAMPAIGN;
  const columnMode = params.columnMode ?? SheetColumnMode.ALL;
  const selectedColumns =
    columnMode === SheetColumnMode.ALL
      ? Array.from(EXPORT_COLUMN_KEYS)
      : ensureRequiredUpsertColumns(normalizeSelectedColumns(params.selectedColumns, SheetColumnMode.MANUAL));
  const campaignStatuses = normalizeCampaignStatuses(params.campaignStatuses);

  const from = parseDateOnlyToUtcDayStart(params.dateFrom);
  const to = parseDateOnlyToUtcDayStart(params.dateTo);

  const runDates = enumerateDateRange({ dateFrom: from, dateTo: to });

  const allRows: Array<{ date: string; values: Array<string | number> }> = [];

  for (const runDate of runDates) {
    if (allRows.length >= take) break;

    const prepared = await prepareRowsForConfig({
      accountId: params.accountId,
      runDate,
      dataMode,
      campaignStatuses,
      selectedColumns,
      campaignNameSearch: params.campaignNameSearch
    });

    for (const row of prepared.rows) {
      if (allRows.length >= take) break;
      allRows.push({ date: toDateOnlyString(runDate), values: row.values });
    }
  }

  return {
    columns: selectedColumns,
    rows: allRows,
    totalRows: allRows.length,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo
  };
}

export async function getSheetExportColumnsCatalog() {
  return {
    availableColumns: Array.from(EXPORT_COLUMN_KEYS)
  };
}

export async function listSheetExportConfigs(filters: {
  accountId?: string;
  active?: boolean;
  take?: number;
}) {
  const take = Math.min(Math.max(filters.take ?? 200, 1), 500);

  const items = await prisma.accountSheetConfig.findMany({
    where: {
      adsAccountId: filters.accountId,
      active: filters.active
    },
    take,
    orderBy: {
      updatedAt: 'desc'
    },
    include: {
      adsAccount: {
        select: {
          id: true,
          customerId: true,
          descriptiveName: true,
          isInMcc: true,
          isManager: true,
          googleStatus: true,
          ingestionEnabled: true
        }
      }
    }
  });

  return {
    items: items.map((item) => mapSheetExportConfig(item))
  };
}

export async function upsertSheetExportConfig(params: {
  adsAccountId: string;
  configId?: string;
  createNew?: boolean;
  spreadsheetId: string;
  sheetName: string;
  writeMode?: SheetWriteMode;
  dataMode?: SheetDataMode;
  columnMode?: SheetColumnMode;
  selectedColumns?: string[];
  campaignStatuses?: string[];
  active?: boolean;
}) {
  await ensureAccountExportable(params.adsAccountId);

  const normalizedSpreadsheetId = normalizeSpreadsheetId(params.spreadsheetId);
  const normalizedSheetName = normalizeSheetName(params.sheetName);
  const columnMode = params.columnMode ?? SheetColumnMode.ALL;
  const selectedColumns =
    columnMode === SheetColumnMode.ALL
      ? []
      : ensureRequiredUpsertColumns(normalizeSelectedColumns(params.selectedColumns, SheetColumnMode.MANUAL));

  const campaignStatuses = normalizeCampaignStatuses(params.campaignStatuses);

  const include = {
    adsAccount: {
      select: {
        id: true,
        customerId: true,
        descriptiveName: true,
        isInMcc: true,
        isManager: true,
        googleStatus: true,
        ingestionEnabled: true
      }
    }
  } satisfies Prisma.AccountSheetConfigInclude;

  const updateData: Prisma.AccountSheetConfigUpdateInput = {
    spreadsheetId: normalizedSpreadsheetId,
    sheetName: normalizedSheetName,
    writeMode: resolveForcedWriteMode(params.writeMode),
    dataMode: params.dataMode,
    columnMode,
    selectedColumnsCsv: toCsvList(selectedColumns),
    campaignStatusesCsv: toCsvList(campaignStatuses),
    active: params.active
  };

  const createData: Prisma.AccountSheetConfigCreateInput = {
    adsAccount: {
      connect: {
        id: params.adsAccountId
      }
    },
    spreadsheetId: normalizedSpreadsheetId,
    sheetName: normalizedSheetName,
    writeMode: resolveForcedWriteMode(params.writeMode),
    dataMode: params.dataMode ?? SheetDataMode.CAMPAIGN,
    columnMode,
    selectedColumnsCsv: toCsvList(selectedColumns),
    campaignStatusesCsv: toCsvList(campaignStatuses),
    active: params.active ?? true
  };

  if (params.configId) {
    const existing = await prisma.accountSheetConfig.findUnique({
      where: {
        id: params.configId
      },
      select: {
        id: true,
        adsAccountId: true,
        spreadsheetId: true,
        sheetName: true
      }
    });

    if (!existing) {
      throw new ApiError(404, 'Sheet export config not found.');
    }

    if (existing.adsAccountId !== params.adsAccountId) {
      throw new ApiError(409, 'Sheet export config does not belong to this account.');
    }

    const destinationChanged =
      existing.spreadsheetId !== normalizedSpreadsheetId || existing.sheetName !== normalizedSheetName;

    const updated = await prisma.$transaction(async (tx) => {
      if (destinationChanged) {
        await tx.sheetRowState.deleteMany({
          where: {
            configId: existing.id
          }
        });
      }

      return tx.accountSheetConfig.update({
        where: {
          id: existing.id
        },
        data: updateData,
        include
      });
    });

    return mapSheetExportConfig(updated);
  }

  if (!params.createNew) {
    const latestExisting = await prisma.accountSheetConfig.findFirst({
      where: {
        adsAccountId: params.adsAccountId
      },
      orderBy: {
        updatedAt: 'desc'
      },
      select: {
        id: true,
        spreadsheetId: true,
        sheetName: true
      }
    });

    if (latestExisting) {
      const destinationChanged =
        latestExisting.spreadsheetId !== normalizedSpreadsheetId || latestExisting.sheetName !== normalizedSheetName;

      const updated = await prisma.$transaction(async (tx) => {
        if (destinationChanged) {
          await tx.sheetRowState.deleteMany({
            where: {
              configId: latestExisting.id
            }
          });
        }

        return tx.accountSheetConfig.update({
          where: {
            id: latestExisting.id
          },
          data: updateData,
          include
        });
      });

      return mapSheetExportConfig(updated);
    }
  }

  const existingCount = await prisma.accountSheetConfig.count({
    where: {
      adsAccountId: params.adsAccountId
    }
  });

  if (existingCount >= MAX_SHEET_CONFIGS_PER_ACCOUNT) {
    throw new ApiError(400, `Too many sheet configs for account (max ${MAX_SHEET_CONFIGS_PER_ACCOUNT}).`);
  }

  const created = await prisma.accountSheetConfig.create({
    data: createData,
    include: {
      adsAccount: include.adsAccount
    }
  });

  return mapSheetExportConfig(created);
}

async function findMatchingConfigForManualExport(params: {
  accountId: string;
  spreadsheetId: string;
  sheetName: string;
  dataMode: SheetDataMode;
  columnMode: SheetColumnMode;
  selectedColumns: SheetExportColumnKey[];
  campaignStatuses: string[];
}): Promise<string | null> {
  const configs = await prisma.accountSheetConfig.findMany({
    where: {
      adsAccountId: params.accountId,
      spreadsheetId: params.spreadsheetId,
      sheetName: params.sheetName,
      dataMode: params.dataMode,
      columnMode: params.columnMode
    },
    select: {
      id: true,
      selectedColumnsCsv: true,
      campaignStatusesCsv: true
    },
    orderBy: {
      updatedAt: 'desc'
    }
  });

  const matched = configs.find((config) => {
    const configSelectedColumns =
      params.columnMode === SheetColumnMode.ALL
        ? Array.from(EXPORT_COLUMN_KEYS)
        : ensureRequiredUpsertColumns(
            normalizeSelectedColumns(parseCsvList(config.selectedColumnsCsv), SheetColumnMode.MANUAL)
          );
    const configCampaignStatuses = normalizeCampaignStatuses(parseCsvList(config.campaignStatusesCsv));

    return (
      areStringArraysEqual(configSelectedColumns, params.selectedColumns) &&
      areStringSetsEqual(configCampaignStatuses, params.campaignStatuses)
    );
  });

  return matched?.id ?? null;
}

export async function deleteSheetExportConfig(configId: string) {
  const existing = await prisma.accountSheetConfig.findUnique({
    where: {
      id: configId
    },
    select: {
      id: true
    }
  });

  if (!existing) {
    throw new ApiError(404, 'Sheet export config not found.');
  }

  const running = await prisma.sheetExportRun.count({
    where: {
      configId,
      status: SheetRunStatus.RUNNING
    }
  });

  if (running > 0) {
    throw new ApiError(409, 'Config has RUNNING exports.');
  }

  await prisma.accountSheetConfig.delete({
    where: {
      id: configId
    }
  });

  return {
    status: 'deleted',
    configId
  };
}

async function createSheetExportRunWithStartLock(params: {
  configId: string;
  runDate: Date;
  triggerSource: TriggerSource;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const lockKey = `${SHEET_EXPORT_START_LOCK_PREFIX}:${params.configId}`;
    const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint) AS locked
    `;

    if (!lockRows[0]?.locked) {
      throw new ApiError(409, 'Another sheet export start is in progress for this config. Retry in a few seconds.');
    }

    const alreadyRunning = await tx.sheetExportRun.findFirst({
      where: {
        configId: params.configId,
        status: SheetRunStatus.RUNNING
      },
      select: {
        id: true
      }
    });

    if (alreadyRunning) {
      throw new ApiError(409, 'Sheet export run is already RUNNING for this config.');
    }

    return tx.sheetExportRun.create({
      data: {
        configId: params.configId,
        runDate: params.runDate,
        status: SheetRunStatus.RUNNING,
        triggerSource: params.triggerSource
      },
      select: {
        id: true
      }
    });
  });
}

export async function runSheetExportConfigById(params: {
  configId: string;
  runDate: Date;
  triggerSource: TriggerSource;
}) {
  const config = await prisma.accountSheetConfig.findUnique({
    where: {
      id: params.configId
    },
    include: {
      adsAccount: {
        select: {
          id: true,
          customerId: true,
          descriptiveName: true,
          isInMcc: true,
          isManager: true,
          googleStatus: true
        }
      }
    }
  });

  if (!config) {
    throw new ApiError(404, 'Sheet export config not found.');
  }

  await ensureAccountExportable(config.adsAccountId);

  const run = await createSheetExportRunWithStartLock({
    configId: config.id,
    runDate: params.runDate,
    triggerSource: params.triggerSource
  });

  try {
    const oauth = await getGoogleOAuthRuntimeToken();
    ensureSheetsScope(oauth.scopes);

    const selectedColumns = resolveSelectedColumns(config);

    const prepared = await prepareRowsForConfig({
      accountId: config.adsAccountId,
      runDate: params.runDate,
      dataMode: config.dataMode,
      campaignStatuses: normalizeCampaignStatuses(parseCsvList(config.campaignStatusesCsv)),
      selectedColumns
    });

    const rowsPrepared = prepared.rows.length;

    const result = await runAppendOrUpsertMode({
      runId: run.id,
      configId: config.id,
      spreadsheetId: config.spreadsheetId,
      sheetName: config.sheetName,
      accessToken: oauth.accessToken,
      headers: prepared.selectedColumns,
      rows: prepared.rows,
      writeMode: SheetWriteMode.UPSERT,
      progressRunId: run.id
    });

    const status = deriveRunStatus({
      rowsPrepared,
      rowsWritten: result.rowsWritten,
      rowsSkipped: result.rowsSkipped,
      rowsFailed: result.rowsFailed
    });

    const updatedRun = await prisma.sheetExportRun.update({
      where: {
        id: run.id
      },
      data: {
        status,
        finishedAt: new Date(),
        rowsPrepared,
        rowsWritten: result.rowsWritten,
        rowsSkipped: result.rowsSkipped,
        rowsFailed: result.rowsFailed,
        errorSummary:
          result.rowErrors.length > 0
            ? truncate(result.rowErrors.slice(0, 3).join(' | '), 1500)
            : null
      },
      include: {
        config: {
          include: {
            adsAccount: {
              select: {
                id: true,
                customerId: true,
                descriptiveName: true
              }
            }
          }
        }
      }
    });

    return {
      run: updatedRun,
      errors: result.rowErrors
    };
  } catch (error) {
    const reason =
      error instanceof GoogleSheetsQuotaExhaustedError
        ? truncate(formatGoogleSheetsQuotaMessage(error.meta), 1500)
        : truncate(toErrorMessage(error), 1500);

    const progress = await prisma.sheetExportRun.findUnique({
      where: {
        id: run.id
      },
      select: {
        rowsPrepared: true,
        rowsWritten: true,
        rowsSkipped: true,
        rowsFailed: true
      }
    });

    await prisma.sheetExportRun.update({
      where: {
        id: run.id
      },
      data: {
        status: SheetRunStatus.FAILED,
        finishedAt: new Date(),
        rowsPrepared: progress?.rowsPrepared ?? 0,
        rowsWritten: progress?.rowsWritten ?? 0,
        rowsSkipped: progress?.rowsSkipped ?? 0,
        rowsFailed: progress?.rowsFailed ?? 0,
        errorSummary: reason
      }
    });

    if (error instanceof GoogleSheetsQuotaExhaustedError) {
      const retryAfterSeconds =
        error.meta.retryAfterSeconds ??
        Math.ceil(
          resolveGoogleSheetsQuotaRetryDelayMs(error.meta, env.GOOGLE_SHEETS_RETRY_BASE_DELAY_MS) / 1000
        );
      const blockedUntil = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();

      throw new ApiError(
        429,
        'Google Sheets quota exhausted. Retry later.',
        {
          configId: params.configId,
          runId: run.id,
          reason,
          retryAfterSeconds,
          blockedUntil,
          quotaMetric: error.meta.quotaMetric,
          quotaLimit: error.meta.quotaLimit,
          quotaLimitValue: error.meta.quotaLimitValue
        },
        'GOOGLE_SHEETS_QUOTA_EXHAUSTED'
      );
    }

    throw new ApiError(502, 'Sheet export run failed.', {
      configId: params.configId,
      runId: run.id,
      reason
    });
  }
}

export async function runSheetExports(params: {
  runDate?: string;
  accountId?: string;
  triggerSource?: TriggerSource;
}) {
  const runDate = params.runDate
    ? parseDateOnlyToUtcDayStart(params.runDate)
    : getDefaultYesterdayRunDate(new Date(), 'Europe/Kyiv');

  const configs = await prisma.accountSheetConfig.findMany({
    where: {
      active: true,
      adsAccountId: params.accountId
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  if (configs.length === 0) {
    throw new ApiError(404, 'No active sheet export configs found.');
  }

  const results: Array<{
    configId: string;
    runId: string;
    status: SheetRunStatus;
    rowsPrepared: number;
    rowsWritten: number;
    rowsFailed: number;
    errorSummary: string | null;
  }> = [];

  for (const config of configs) {
    try {
      const outcome = await runSheetExportConfigById({
        configId: config.id,
        runDate,
        triggerSource: params.triggerSource ?? TriggerSource.MANUAL
      });

      results.push({
        configId: config.id,
        runId: outcome.run.id,
        status: outcome.run.status,
        rowsPrepared: outcome.run.rowsPrepared,
        rowsWritten: outcome.run.rowsWritten,
        rowsFailed: outcome.run.rowsFailed,
        errorSummary: outcome.run.errorSummary
      });
    } catch (error) {
      results.push({
        configId: config.id,
        runId: 'FAILED_TO_START',
        status: SheetRunStatus.FAILED,
        rowsPrepared: 0,
        rowsWritten: 0,
        rowsFailed: 0,
        errorSummary: truncate(toErrorMessage(error), 400)
      });
    }
  }

  return {
    runDate: toDateOnlyString(runDate),
    items: results
  };
}

async function runManualSheetExportForDateInternal(params: {
  accountId: string;
  runDate: Date;
  spreadsheetId: string;
  sheetName: string;
  writeMode: SheetWriteMode;
  dataMode: SheetDataMode;
  columnMode: SheetColumnMode;
  selectedColumns?: string[];
  campaignStatuses?: string[];
  campaignNameSearch?: string;
}) {
  await ensureAccountExportable(params.accountId);

  const normalizedSpreadsheetId = normalizeSpreadsheetId(params.spreadsheetId);
  const normalizedSheetName = normalizeSheetName(params.sheetName);
  const selectedColumns =
    params.columnMode === SheetColumnMode.ALL
      ? Array.from(EXPORT_COLUMN_KEYS)
      : ensureRequiredUpsertColumns(normalizeSelectedColumns(params.selectedColumns, SheetColumnMode.MANUAL));
  const campaignStatuses = normalizeCampaignStatuses(params.campaignStatuses);

  const oauth = await getGoogleOAuthRuntimeToken();
  ensureSheetsScope(oauth.scopes);

  const prepared = await prepareRowsForConfig({
    accountId: params.accountId,
    runDate: params.runDate,
    dataMode: params.dataMode,
    campaignStatuses,
    selectedColumns,
    campaignNameSearch: params.campaignNameSearch
  });

  const matchingConfigId = await findMatchingConfigForManualExport({
    accountId: params.accountId,
    spreadsheetId: normalizedSpreadsheetId,
    sheetName: normalizedSheetName,
    dataMode: params.dataMode,
    columnMode: params.columnMode,
    selectedColumns: prepared.selectedColumns,
    campaignStatuses
  });

  const runId = `MANUAL-${params.accountId}-${toDateOnlyString(params.runDate)}-${Date.now()}`;

  const result = await runAppendOrUpsertMode({
    runId,
    configId: matchingConfigId ?? `MANUAL-${params.accountId}`,
    spreadsheetId: normalizedSpreadsheetId,
    sheetName: normalizedSheetName,
    accessToken: oauth.accessToken,
    headers: prepared.selectedColumns,
    rows: prepared.rows,
    writeMode: SheetWriteMode.UPSERT,
    persistRowState: matchingConfigId !== null
  });

  const status = deriveRunStatus({
    rowsPrepared: prepared.rows.length,
    rowsWritten: result.rowsWritten,
    rowsSkipped: result.rowsSkipped,
    rowsFailed: result.rowsFailed
  });

  return {
    runDate: toDateOnlyString(params.runDate),
    status,
    rowsPrepared: prepared.rows.length,
    rowsWritten: result.rowsWritten,
    rowsSkipped: result.rowsSkipped,
    rowsFailed: result.rowsFailed,
    errorSummary: result.rowErrors.length > 0 ? truncate(result.rowErrors.slice(0, 3).join(' | '), 1500) : null,
    selectedColumns: prepared.selectedColumns
  };
}

function mapManualRangeRun<T extends {
  selectedColumnsCsv: string;
  campaignStatusesCsv: string;
}>(run: T): T & {
  selectedColumns: string[];
  campaignStatuses: string[];
} {
  return {
    ...run,
    selectedColumns: parseCsvList(run.selectedColumnsCsv),
    campaignStatuses: parseCsvList(run.campaignStatusesCsv)
  };
}

async function validateSpreadsheetAccess(run: {
  spreadsheetId: string;
  sheetName: string;
}): Promise<void> {
  const oauth = await getGoogleOAuthRuntimeToken();
  ensureSheetsScope(oauth.scopes);

  await ensureSheetTabExists({
    spreadsheetId: run.spreadsheetId,
    sheetName: run.sheetName,
    accessToken: oauth.accessToken
  });
}

async function executeManualRangeRun(runId: string): Promise<void> {
  const run = await prisma.sheetManualRangeRun.findUnique({
    where: {
      id: runId
    }
  });

  if (!run || run.status !== SheetRunStatus.RUNNING) {
    return;
  }

  const runDates = enumerateDateRange({
    dateFrom: run.dateFrom,
    dateTo: run.dateTo
  });

  let completedDays = run.completedDays;
  let successDays = run.successDays;
  let failedDays = run.failedDays;
  const dayErrors: string[] = [];
  if (completedDays === 0) {
    // Preflight: validate spreadsheet access before processing any days to avoid
    // repeating the same error for each day.
    try {
      await validateSpreadsheetAccess({
        spreadsheetId: run.spreadsheetId,
        sheetName: run.sheetName
      });
    } catch (error) {
      const reason = truncate(toErrorMessage(error), 1500);
      await prisma.sheetManualRangeRun.update({
        where: {
          id: run.id
        },
        data: {
          status: SheetRunStatus.FAILED,
          finishedAt: new Date(),
          errorSummary: reason
        }
      });
      return;
    }
  }

  for (const runDate of runDates) {
    const existingDay = await prisma.sheetManualRangeRunDay.findUnique({
      where: {
        manualRunId_runDate: {
          manualRunId: run.id,
          runDate
        }
      }
    });

    if (existingDay?.finishedAt) {
      continue;
    }

    const dayRun =
      existingDay ??
      (await prisma.sheetManualRangeRunDay.create({
        data: {
          manualRunId: run.id,
          runDate,
          status: SheetRunStatus.RUNNING
        }
      }));

    try {
      const result = await runManualSheetExportForDateInternal({
        accountId: run.adsAccountId,
        runDate,
        spreadsheetId: run.spreadsheetId,
        sheetName: run.sheetName,
        writeMode: run.writeMode,
        dataMode: run.dataMode,
        columnMode: run.columnMode,
        selectedColumns: parseCsvList(run.selectedColumnsCsv),
        campaignStatuses: parseCsvList(run.campaignStatusesCsv),
        campaignNameSearch: run.campaignNameSearch || undefined
      });

      const hasFailure =
        result.status === SheetRunStatus.FAILED ||
        result.status === SheetRunStatus.PARTIAL ||
        result.status === SheetRunStatus.CANCELLED ||
        result.rowsFailed > 0;

      completedDays += 1;
      if (hasFailure) {
        failedDays += 1;
        if (result.errorSummary) {
          dayErrors.push(`[${result.runDate}] ${result.errorSummary}`);
        }
      } else {
        successDays += 1;
      }

      await prisma.$transaction([
        prisma.sheetManualRangeRunDay.update({
          where: {
            id: dayRun.id
          },
          data: {
            status: result.status,
            rowsPrepared: result.rowsPrepared,
            rowsWritten: result.rowsWritten,
            rowsSkipped: result.rowsSkipped,
            rowsFailed: result.rowsFailed,
            errorSummary: result.errorSummary,
            finishedAt: new Date()
          }
        }),
        prisma.sheetManualRangeRun.update({
          where: {
            id: run.id
          },
          data: {
            completedDays,
            successDays,
            failedDays,
            errorSummary: dayErrors.length > 0 ? truncate(dayErrors.slice(-3).join(' | '), 1500) : null
          }
        })
      ]);
    } catch (error) {
      const reason = truncate(toErrorMessage(error), 1500);

      completedDays += 1;
      failedDays += 1;
      dayErrors.push(`[${toDateOnlyString(runDate)}] ${reason}`);

      await prisma.$transaction([
        prisma.sheetManualRangeRunDay.update({
          where: {
            id: dayRun.id
          },
          data: {
            status: SheetRunStatus.FAILED,
            rowsPrepared: 0,
            rowsWritten: 0,
            rowsSkipped: 0,
            rowsFailed: 0,
            errorSummary: reason,
            finishedAt: new Date()
          }
        }),
        prisma.sheetManualRangeRun.update({
          where: {
            id: run.id
          },
          data: {
            completedDays,
            successDays,
            failedDays,
            errorSummary: truncate(dayErrors.slice(-3).join(' | '), 1500)
          }
        })
      ]);
    }
  }

  await prisma.sheetManualRangeRun.update({
    where: {
      id: run.id
    },
    data: {
      status: deriveManualRangeRunStatus({
        totalDays: run.totalDays,
        failedDays
      }),
      completedDays,
      successDays,
      failedDays,
      finishedAt: new Date(),
      errorSummary: dayErrors.length > 0 ? truncate(dayErrors.slice(-3).join(' | '), 1500) : run.errorSummary
    }
  });
}

async function processManualRangeRunQueue(): Promise<void> {
  if (manualRangeRunWorkerBusy) {
    return;
  }

  manualRangeRunWorkerBusy = true;
  try {
    while (manualRangeRunQueue.length > 0) {
      const runId = manualRangeRunQueue.shift();
      if (!runId) {
        continue;
      }

      manualRangeRunQueueSet.delete(runId);

      try {
        await executeManualRangeRun(runId);
      } catch {
        // Safe to ignore: run status updates are persisted per-step.
      }
    }
  } finally {
    manualRangeRunWorkerBusy = false;
  }
}

function enqueueManualRangeRun(runId: string): void {
  if (manualRangeRunQueueSet.has(runId)) {
    return;
  }

  manualRangeRunQueue.push(runId);
  manualRangeRunQueueSet.add(runId);
  void processManualRangeRunQueue();
}

export async function recoverRunningManualRangeRuns(): Promise<number> {
  const runningRuns = await prisma.sheetManualRangeRun.findMany({
    where: {
      status: SheetRunStatus.RUNNING
    },
    select: {
      id: true
    }
  });

  for (const run of runningRuns) {
    enqueueManualRangeRun(run.id);
  }

  return runningRuns.length;
}

export async function startManualSheetExportRange(params: {
  accountId: string;
  dateFrom: string;
  dateTo: string;
  spreadsheetId: string;
  sheetName: string;
  writeMode?: SheetWriteMode;
  dataMode?: SheetDataMode;
  columnMode?: SheetColumnMode;
  selectedColumns?: string[];
  campaignStatuses?: string[];
  campaignNameSearch?: string;
}) {
  await ensureAccountExportable(params.accountId);

  const window = buildManualRangeWindow({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo
  });

  const columnMode = params.columnMode ?? SheetColumnMode.ALL;
  const selectedColumns =
    columnMode === SheetColumnMode.ALL
      ? []
      : ensureRequiredUpsertColumns(normalizeSelectedColumns(params.selectedColumns, SheetColumnMode.MANUAL));
  const campaignStatuses = normalizeCampaignStatuses(params.campaignStatuses);

  const run = await prisma.sheetManualRangeRun.create({
    data: {
      adsAccountId: params.accountId,
      spreadsheetId: normalizeSpreadsheetId(params.spreadsheetId),
      sheetName: normalizeSheetName(params.sheetName),
      writeMode: resolveForcedWriteMode(params.writeMode),
      dataMode: params.dataMode ?? SheetDataMode.CAMPAIGN,
      columnMode,
      selectedColumnsCsv: toCsvList(selectedColumns),
      campaignStatusesCsv: toCsvList(campaignStatuses),
      campaignNameSearch: params.campaignNameSearch?.trim() ?? '',
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      totalDays: window.totalDays,
      status: SheetRunStatus.RUNNING
    },
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

  enqueueManualRangeRun(run.id);

  return {
    run: mapManualRangeRun(run)
  };
}

export async function runManualSheetExportForDate(params: {
  accountId: string;
  runDate?: string;
  spreadsheetId: string;
  sheetName: string;
  writeMode?: SheetWriteMode;
  dataMode?: SheetDataMode;
  columnMode?: SheetColumnMode;
  selectedColumns?: string[];
  campaignStatuses?: string[];
  campaignNameSearch?: string;
}) {
  const runDate = params.runDate
    ? parseDateOnlyToUtcDayStart(params.runDate)
    : getDefaultYesterdayRunDate(new Date(), 'Europe/Kyiv');

  return runManualSheetExportForDateInternal({
    accountId: params.accountId,
    runDate,
    spreadsheetId: params.spreadsheetId,
    sheetName: params.sheetName,
    writeMode: resolveForcedWriteMode(params.writeMode),
    dataMode: params.dataMode ?? SheetDataMode.CAMPAIGN,
    columnMode: params.columnMode ?? SheetColumnMode.ALL,
    selectedColumns: params.selectedColumns,
    campaignStatuses: params.campaignStatuses,
    campaignNameSearch: params.campaignNameSearch
  });
}

export async function listManualSheetExportRangeRuns(filters: {
  accountId?: string;
  status?: SheetRunStatus;
  take?: number;
}) {
  const take = Math.min(Math.max(filters.take ?? 30, 1), 200);

  const items = await prisma.sheetManualRangeRun.findMany({
    where: {
      adsAccountId: filters.accountId,
      status: filters.status
    },
    take,
    orderBy: {
      startedAt: 'desc'
    },
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

  return {
    items: items.map((item) => mapManualRangeRun(item))
  };
}

export async function getManualSheetExportRangeRunById(runId: string) {
  const run = await prisma.sheetManualRangeRun.findUnique({
    where: {
      id: runId
    },
    include: {
      adsAccount: {
        select: {
          id: true,
          customerId: true,
          descriptiveName: true,
          isInMcc: true,
          isManager: true,
          googleStatus: true
        }
      },
      dayRuns: {
        orderBy: {
          runDate: 'asc'
        }
      }
    }
  });

  if (!run) {
    throw new ApiError(404, 'Manual sheet range run not found.');
  }

  return mapManualRangeRun(run);
}

export async function listSheetExportRuns(filters: {
  accountId?: string;
  status?: SheetRunStatus;
  triggerSource?: TriggerSource;
  take?: number;
}) {
  const take = Math.min(Math.max(filters.take ?? 50, 1), 200);

  const items = await prisma.sheetExportRun.findMany({
    where: {
      status: filters.status,
      triggerSource: filters.triggerSource,
      config: filters.accountId
        ? {
            adsAccountId: filters.accountId
          }
        : undefined
    },
    take,
    orderBy: {
      startedAt: 'desc'
    },
    include: {
      config: {
        include: {
          adsAccount: {
            select: {
              id: true,
              customerId: true,
              descriptiveName: true
            }
          }
        }
      }
    }
  });

  return {
    items
  };
}

export async function getSheetExportRunById(runId: string) {
  const run = await prisma.sheetExportRun.findUnique({
    where: {
      id: runId
    },
    include: {
      config: {
        include: {
          adsAccount: {
            select: {
              id: true,
              customerId: true,
              descriptiveName: true,
              isInMcc: true,
              isManager: true,
              googleStatus: true
            }
          }
        }
      }
    }
  });

  if (!run) {
    throw new ApiError(404, 'Sheet export run not found.');
  }

  return run;
}

export async function markStaleSheetRunsAsFailed(): Promise<number> {
  const staleBefore = new Date(Date.now() - env.SHEETS_RUN_STALE_MINUTES * MINUTE_MS);

  const staleRuns = await prisma.sheetExportRun.findMany({
    where: {
      status: SheetRunStatus.RUNNING,
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

  await prisma.sheetExportRun.updateMany({
    where: {
      id: {
        in: staleRuns.map((item) => item.id)
      },
      status: SheetRunStatus.RUNNING
    },
    data: {
      status: SheetRunStatus.FAILED,
      finishedAt: new Date(),
      errorSummary: `Auto-failed stale run (no progress) after ${env.SHEETS_RUN_STALE_MINUTES} minutes.`
    }
  });

  return staleRuns.length;
}

export async function getSheetExportHealth() {
  const now = new Date();
  const yesterday = getDefaultYesterdayRunDate(now, 'Europe/Kyiv');

  const [activeConfigs, schedulableRuns, runningCount, staleRunningCount, recentRuns] = await Promise.all([
    prisma.accountSheetConfig.count({
      where: {
        active: true
      }
    }),
    prisma.sheetExportRun.findMany({
      where: {
        triggerSource: TriggerSource.SCHEDULER,
        runDate: yesterday
      },
      select: {
        status: true
      }
    }),
    prisma.sheetExportRun.count({
      where: {
        status: SheetRunStatus.RUNNING
      }
    }),
    prisma.sheetExportRun.count({
      where: {
        status: SheetRunStatus.RUNNING,
        updatedAt: {
          lt: new Date(Date.now() - env.SHEETS_RUN_STALE_MINUTES * MINUTE_MS)
        }
      }
    }),
    prisma.sheetExportRun.findMany({
      take: 20,
      orderBy: {
        startedAt: 'desc'
      },
      include: {
        config: {
          include: {
            adsAccount: {
              select: {
                id: true,
                customerId: true,
                descriptiveName: true
              }
            }
          }
        }
      }
    })
  ]);

  return {
    configs: {
      active: activeConfigs
    },
    runs: {
      running: runningCount,
      staleRunning: staleRunningCount,
      schedulerAttemptsForYesterday: {
        date: toDateOnlyString(yesterday),
        total: schedulableRuns.length,
        success: schedulableRuns.filter((item) => item.status === SheetRunStatus.SUCCESS).length,
        failed: schedulableRuns.filter((item) => item.status === SheetRunStatus.FAILED).length,
        partial: schedulableRuns.filter((item) => item.status === SheetRunStatus.PARTIAL).length,
        skipped: schedulableRuns.filter((item) => item.status === SheetRunStatus.SKIPPED).length,
        cancelled: schedulableRuns.filter((item) => item.status === SheetRunStatus.CANCELLED).length
      },
      recent: recentRuns
    }
  };
}

