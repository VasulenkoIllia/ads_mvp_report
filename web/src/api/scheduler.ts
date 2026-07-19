import { get, patch, post } from './client.js';

export type SchedulerSettings = {
  id: string;
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
  updatedAt: string;
};

export type SchedulerHealth = {
  settings: SchedulerSettings;
  runtime: {
    pollSeconds: number;
    catchupDays: number;
    refreshDays: number;
    nextIngestionAt: string;
    nextSheetsAt: string;
  };
};

export type BackfillStatus = 'IDLE' | 'REQUESTED' | 'INGESTING' | 'EXPORTING';

export type BackfillState = {
  id: string;
  status: BackfillStatus;
  trigger: 'REAUTH' | 'MANUAL' | null;
  fromDate: string | null;
  toDate: string | null;
  cursorDate: string | null;
  daysTotal: number;
  daysDone: number;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type BackfillInfo = {
  state: BackfillState;
  config: {
    enabled: boolean;
    lookbackDays: number;
    maxDays: number;
    dayMaxAttempts: number;
  };
};

export const schedulerApi = {
  getSettings: () => get<SchedulerSettings>('/scheduler/settings'),
  patchSettings: (data: Partial<Omit<SchedulerSettings, 'id' | 'updatedAt'>>) =>
    patch<SchedulerSettings>('/scheduler/settings', data),
  getHealth: () => get<SchedulerHealth>('/scheduler/health'),
  getBackfill: () => get<BackfillInfo>('/scheduler/backfill'),
  requestBackfill: () => post<{ requested: boolean; state: BackfillState }>('/scheduler/backfill'),
};
