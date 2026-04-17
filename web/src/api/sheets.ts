import { del, get, post, put, qs } from './client.js';

export type SheetConfig = {
  id: string;
  adsAccountId: string;
  spreadsheetId: string;
  sheetName: string;
  writeMode: string;
  dataMode: string;
  columnMode: string;
  selectedColumns: string[];
  campaignStatuses: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  adsAccount: { id: string; customerId: string; descriptiveName: string; googleStatus: string | null; ingestionEnabled: boolean };
};

export type SheetExportRun = {
  id: string;
  configId: string;
  runDate: string;
  status: string;
  triggerSource: string;
  rowsPrepared: number;
  rowsWritten: number;
  rowsSkipped: number;
  rowsFailed: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ManualRangeRun = {
  id: string;
  adsAccountId: string;
  spreadsheetId: string;
  sheetName: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  writeMode: string;
  dataMode: string;
  totalDays: number;
  completedDays: number;
  successDays: number;
  failedDays: number;
  errorSummary: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type SheetPreviewResult = {
  columns: string[];
  rows: Array<{ date: string; values: Array<string | number> }>;
  totalRows: number;
  dateFrom: string;
  dateTo: string;
};

export const sheetsApi = {
  listConfigs: (filters?: { accountId?: string; active?: boolean; take?: number }) =>
    get<{ items: SheetConfig[] }>(`/sheets/configs${qs(filters ?? {})}`),

  upsertConfig: (accountId: string, data: {
    configId?: string;
    createNew?: boolean;
    spreadsheetId: string;
    sheetName: string;
    writeMode?: string;
    dataMode?: string;
    columnMode?: string;
    selectedColumns?: string[];
    campaignStatuses?: string[];
    active?: boolean;
  }) => put<SheetConfig>(`/sheets/configs/${accountId}`, data),

  deleteConfig: (configId: string) => del<{ status: string }>(`/sheets/configs/${configId}`),

  startRangeRun: (params: {
    accountId: string;
    dateFrom: string;
    dateTo: string;
    spreadsheetId: string;
    sheetName: string;
    writeMode?: string;
    dataMode?: string;
    columnMode?: string;
    selectedColumns?: string[];
    campaignStatuses?: string[];
    campaignNameSearch?: string;
  }) => post<{ runId: string }>('/sheets/manual-range-runs', params),

  listRangeRuns: (filters?: { accountId?: string; status?: string; take?: number }) =>
    get<{ items: ManualRangeRun[] }>(`/sheets/manual-range-runs${qs(filters ?? {})}`),

  listRuns: (filters?: { accountId?: string; status?: string; take?: number }) =>
    get<{ items: SheetExportRun[] }>(`/sheets/runs${qs(filters ?? {})}`),

  preview: (params: {
    accountId: string;
    dateFrom: string;
    dateTo: string;
    dataMode?: string;
    columnMode?: string;
    selectedColumns?: string;
    campaignStatuses?: string;
    campaignNameSearch?: string;
    take?: number;
  }) => get<SheetPreviewResult>(`/sheets/preview${qs(params)}`),

  getHealth: () => get<{
    configs: { active: number };
    runs: {
      running: number;
      staleRunning: number;
      schedulerAttemptsForYesterday: {
        date: string; total: number; success: number; failed: number;
        partial: number; skipped: number; cancelled: number;
      };
      recent: SheetExportRun[];
    };
  }>('/sheets/health'),

};
