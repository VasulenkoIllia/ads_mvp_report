import { get, patch } from './client.js';

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

export const schedulerApi = {
  getSettings: () => get<SchedulerSettings>('/scheduler/settings'),
  patchSettings: (data: Partial<Omit<SchedulerSettings, 'id' | 'updatedAt'>>) =>
    patch<SchedulerSettings>('/scheduler/settings', data),
  getHealth: () => get<SchedulerHealth>('/scheduler/health'),
};
