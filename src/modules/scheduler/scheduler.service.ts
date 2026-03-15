import { IngestionRunStatus, SheetRunStatus, TriggerSource } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/http.js';
import {
  getCatchupRunDates,
  getNextScheduledAt,
  getUtcDayWindow,
  hasReachedScheduleTime,
  toDateOnlyString
} from '../../lib/timezone.js';
import {
  markStaleIngestionRunsAsFailed,
  runGoogleAdsIngestion
} from '../ingestion/ingestion.service.js';
import {
  markStaleSheetRunsAsFailed,
  recoverRunningManualRangeRuns,
  runSheetExportConfigById
} from '../sheets/sheets.service.js';

type SchedulerLogger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

type SchedulerSettingsPayload = {
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
  createdAt: string;
  updatedAt: string;
};

function defaultLogger(scope: string): SchedulerLogger {
  const tag = `[${scope}]`;

  return {
    info: (meta, message) => {
      // eslint-disable-next-line no-console
      console.log(tag, message ?? '', meta ?? {});
    },
    warn: (meta, message) => {
      // eslint-disable-next-line no-console
      console.warn(tag, message ?? '', meta ?? {});
    },
    error: (meta, message) => {
      // eslint-disable-next-line no-console
      console.error(tag, message ?? '', meta ?? {});
    },
    debug: (meta, message) => {
      if (env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.log(tag, message ?? '', meta ?? {});
      }
    }
  };
}

function clampHour(value: number | undefined, fallback: number): number {
  const normalized = Math.round(value ?? fallback);
  return Math.min(Math.max(normalized, 0), 23);
}

function clampMinute(value: number | undefined, fallback: number): number {
  const normalized = Math.round(value ?? fallback);
  return Math.min(Math.max(normalized, 0), 59);
}

function clampMaxAttempts(value: number | undefined, fallback: number): number {
  const normalized = Math.round(value ?? fallback);
  return Math.min(Math.max(normalized, 1), 10);
}

function clampDelay(value: number | undefined, fallback: number): number {
  const normalized = Math.round(value ?? fallback);
  return Math.min(Math.max(normalized, 1), 180);
}

function clampBatchSize(value: number | undefined, fallback: number): number {
  const normalized = Math.round(value ?? fallback);
  return Math.min(Math.max(normalized, 10), 500);
}

function clampMaxAccounts(value: number | undefined, fallback: number): number {
  const normalized = Math.round(value ?? fallback);
  return Math.min(Math.max(normalized, 1), 20000);
}

function clampMaxConfigsPerTick(value: number | undefined, fallback: number): number {
  const normalized = Math.round(value ?? fallback);
  return Math.min(Math.max(normalized, 1), 2000);
}

async function getOrCreateSchedulerSettings() {
  return prisma.schedulerSettings.upsert({
    where: {
      id: 'GLOBAL'
    },
    create: {
      id: 'GLOBAL',
      timezone: 'Europe/Kyiv',
      ingestionEnabled: true,
      ingestionHour: 1,
      ingestionMinute: 0,
      ingestionMaxDailyAttempts: 2,
      ingestionRetryDelayMin: 20,
      ingestionBatchSize: 100,
      ingestionMaxAccounts: 5000,
      sheetsEnabled: true,
      sheetsHour: 1,
      sheetsMinute: 10,
      sheetsMaxDailyAttempts: 2,
      sheetsRetryDelayMin: 20,
      sheetsMaxConfigsPerTick: 200
    },
    update: {}
  });
}

function mapSettingsPayload(settings: Awaited<ReturnType<typeof getOrCreateSchedulerSettings>>): SchedulerSettingsPayload {
  return {
    id: settings.id,
    timezone: settings.timezone,
    ingestionEnabled: settings.ingestionEnabled,
    ingestionHour: settings.ingestionHour,
    ingestionMinute: settings.ingestionMinute,
    ingestionMaxDailyAttempts: settings.ingestionMaxDailyAttempts,
    ingestionRetryDelayMin: settings.ingestionRetryDelayMin,
    ingestionBatchSize: settings.ingestionBatchSize,
    ingestionMaxAccounts: settings.ingestionMaxAccounts,
    sheetsEnabled: settings.sheetsEnabled,
    sheetsHour: settings.sheetsHour,
    sheetsMinute: settings.sheetsMinute,
    sheetsMaxDailyAttempts: settings.sheetsMaxDailyAttempts,
    sheetsRetryDelayMin: settings.sheetsRetryDelayMin,
    sheetsMaxConfigsPerTick: settings.sheetsMaxConfigsPerTick,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString()
  };
}

export async function getSchedulerSettings(): Promise<SchedulerSettingsPayload> {
  const settings = await getOrCreateSchedulerSettings();
  return mapSettingsPayload(settings);
}

export async function updateSchedulerSettings(input: {
  timezone?: string;
  ingestionEnabled?: boolean;
  ingestionHour?: number;
  ingestionMinute?: number;
  ingestionMaxDailyAttempts?: number;
  ingestionRetryDelayMin?: number;
  ingestionBatchSize?: number;
  ingestionMaxAccounts?: number;
  sheetsEnabled?: boolean;
  sheetsHour?: number;
  sheetsMinute?: number;
  sheetsMaxDailyAttempts?: number;
  sheetsRetryDelayMin?: number;
  sheetsMaxConfigsPerTick?: number;
}): Promise<SchedulerSettingsPayload> {
  const current = await getOrCreateSchedulerSettings();

  const timezone = input.timezone?.trim();
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    } catch {
      throw new ApiError(400, 'Invalid timezone value.');
    }
  }

  const settings = await prisma.schedulerSettings.update({
    where: {
      id: current.id
    },
    data: {
      timezone: timezone ?? undefined,
      ingestionEnabled: input.ingestionEnabled,
      ingestionHour: input.ingestionHour === undefined ? undefined : clampHour(input.ingestionHour, current.ingestionHour),
      ingestionMinute:
        input.ingestionMinute === undefined ? undefined : clampMinute(input.ingestionMinute, current.ingestionMinute),
      ingestionMaxDailyAttempts:
        input.ingestionMaxDailyAttempts === undefined
          ? undefined
          : clampMaxAttempts(input.ingestionMaxDailyAttempts, current.ingestionMaxDailyAttempts),
      ingestionRetryDelayMin:
        input.ingestionRetryDelayMin === undefined
          ? undefined
          : clampDelay(input.ingestionRetryDelayMin, current.ingestionRetryDelayMin),
      ingestionBatchSize:
        input.ingestionBatchSize === undefined
          ? undefined
          : clampBatchSize(input.ingestionBatchSize, current.ingestionBatchSize),
      ingestionMaxAccounts:
        input.ingestionMaxAccounts === undefined
          ? undefined
          : clampMaxAccounts(input.ingestionMaxAccounts, current.ingestionMaxAccounts),
      sheetsEnabled: input.sheetsEnabled,
      sheetsHour: input.sheetsHour === undefined ? undefined : clampHour(input.sheetsHour, current.sheetsHour),
      sheetsMinute: input.sheetsMinute === undefined ? undefined : clampMinute(input.sheetsMinute, current.sheetsMinute),
      sheetsMaxDailyAttempts:
        input.sheetsMaxDailyAttempts === undefined
          ? undefined
          : clampMaxAttempts(input.sheetsMaxDailyAttempts, current.sheetsMaxDailyAttempts),
      sheetsRetryDelayMin:
        input.sheetsRetryDelayMin === undefined
          ? undefined
          : clampDelay(input.sheetsRetryDelayMin, current.sheetsRetryDelayMin),
      sheetsMaxConfigsPerTick:
        input.sheetsMaxConfigsPerTick === undefined
          ? undefined
          : clampMaxConfigsPerTick(input.sheetsMaxConfigsPerTick, current.sheetsMaxConfigsPerTick)
    }
  });

  return mapSettingsPayload(settings);
}

export async function getSchedulerHealth() {
  const settings = await getOrCreateSchedulerSettings();
  const now = new Date();

  const nextIngestionAt = getNextScheduledAt(
    now,
    {
      hour: settings.ingestionHour,
      minute: settings.ingestionMinute
    },
    settings.timezone
  );

  const nextSheetsAt = getNextScheduledAt(
    now,
    {
      hour: settings.sheetsHour,
      minute: settings.sheetsMinute
    },
    settings.timezone
  );

  return {
    settings: mapSettingsPayload(settings),
    runtime: {
      pollSeconds: env.SCHEDULER_POLL_SECONDS,
      catchupDays: env.SCHEDULER_CATCHUP_DAYS,
      nextIngestionAt: nextIngestionAt.toISOString(),
      nextSheetsAt: nextSheetsAt.toISOString()
    }
  };
}

async function runIngestionSchedulerTick(settings: Awaited<ReturnType<typeof getOrCreateSchedulerSettings>>, logger: SchedulerLogger) {
  if (!settings.ingestionEnabled) {
    return;
  }

  const now = new Date();
  if (
    !hasReachedScheduleTime(
      now,
      {
        hour: settings.ingestionHour,
        minute: settings.ingestionMinute
      },
      settings.timezone
    )
  ) {
    return;
  }

  const runDates = getCatchupRunDates(now, settings.timezone, env.SCHEDULER_CATCHUP_DAYS);

  for (const runDate of runDates) {
    const window = getUtcDayWindow(runDate);
    const runDateText = toDateOnlyString(runDate);

    const [completedAny, schedulerRuns] = await Promise.all([
      prisma.ingestionRun.findFirst({
        where: {
          runDate: {
            gte: window.start,
            lt: window.end
          },
          status: {
            in: [IngestionRunStatus.SUCCESS, IngestionRunStatus.PARTIAL]
          }
        },
        select: {
          id: true
        }
      }),
      prisma.ingestionRun.findMany({
        where: {
          triggerSource: TriggerSource.SCHEDULER,
          runDate: {
            gte: window.start,
            lt: window.end
          }
        },
        orderBy: {
          startedAt: 'desc'
        },
        select: {
          id: true,
          status: true,
          finishedAt: true
        }
      })
    ]);

    if (completedAny) {
      continue;
    }

    if (schedulerRuns.some((run) => run.status === IngestionRunStatus.RUNNING)) {
      continue;
    }

    if (schedulerRuns.length >= settings.ingestionMaxDailyAttempts) {
      continue;
    }

    const retryable = schedulerRuns.find(
      (run) => run.status === IngestionRunStatus.FAILED || run.status === IngestionRunStatus.CANCELLED
    );

    if (retryable?.finishedAt) {
      const minutesSinceFailed = Math.floor((now.getTime() - retryable.finishedAt.getTime()) / (60 * 1000));
      if (minutesSinceFailed < settings.ingestionRetryDelayMin) {
        continue;
      }
    }

    const result = await runGoogleAdsIngestion({
      runDate: runDateText,
      triggerSource: TriggerSource.SCHEDULER,
      enabledOnly: true,
      takeAccounts: settings.ingestionMaxAccounts,
      batchSize: settings.ingestionBatchSize
    });

    logger.info(
      {
        runId: result.run.id,
        runDate: runDateText,
        status: result.run.status,
        processedAccounts: result.run.processedAccounts,
        failedAccounts: result.run.failedAccounts,
        rowsUpserted: result.run.rowsUpserted
      },
      'Automatic ingestion run finished.'
    );

    break;
  }
}

async function runSheetsSchedulerTick(settings: Awaited<ReturnType<typeof getOrCreateSchedulerSettings>>, logger: SchedulerLogger) {
  if (!settings.sheetsEnabled) {
    return;
  }

  const now = new Date();
  if (
    !hasReachedScheduleTime(
      now,
      {
        hour: settings.sheetsHour,
        minute: settings.sheetsMinute
      },
      settings.timezone
    )
  ) {
    return;
  }

  const configs = await prisma.accountSheetConfig.findMany({
    where: {
      active: true
    },
    orderBy: {
      createdAt: 'asc'
    },
    take: settings.sheetsMaxConfigsPerTick,
    select: {
      id: true
    }
  });

  if (configs.length === 0) {
    return;
  }

  const runDates = getCatchupRunDates(now, settings.timezone, env.SCHEDULER_CATCHUP_DAYS);

  for (const runDate of runDates) {
    const runDateText = toDateOnlyString(runDate);
    let launchedAny = false;

    for (const config of configs) {
      const configRuns = await prisma.sheetExportRun.findMany({
        where: {
          configId: config.id,
          triggerSource: TriggerSource.SCHEDULER,
          runDate
        },
        orderBy: {
          startedAt: 'desc'
        },
        select: {
          id: true,
          status: true,
          finishedAt: true
        }
      });

      const hasCompleted = configRuns.some(
        (run) =>
          run.status === SheetRunStatus.SUCCESS ||
          run.status === SheetRunStatus.PARTIAL ||
          run.status === SheetRunStatus.SKIPPED
      );

      if (hasCompleted) {
        continue;
      }

      if (configRuns.some((run) => run.status === SheetRunStatus.RUNNING)) {
        continue;
      }

      if (configRuns.length >= settings.sheetsMaxDailyAttempts) {
        continue;
      }

      const retryable = configRuns.find(
        (run) => run.status === SheetRunStatus.FAILED || run.status === SheetRunStatus.CANCELLED
      );
      if (retryable?.finishedAt) {
        const minutesSinceFailed = Math.floor((now.getTime() - retryable.finishedAt.getTime()) / (60 * 1000));
        if (minutesSinceFailed < settings.sheetsRetryDelayMin) {
          continue;
        }
      }

      try {
        const result = await runSheetExportConfigById({
          configId: config.id,
          runDate,
          triggerSource: TriggerSource.SCHEDULER
        });

        logger.info(
          {
            configId: config.id,
            runDate: runDateText,
            result
          },
          'Automatic sheet export run finished.'
        );
      } catch (error) {
        logger.error(
          {
            configId: config.id,
            runDate: runDateText,
            error: error instanceof Error ? error.message : String(error)
          },
          'Automatic sheet export run failed.'
        );
      }

      launchedAny = true;
    }

    if (launchedAny) {
      break;
    }
  }
}

export function startSchedulers(logger?: Partial<SchedulerLogger>) {
  const fallback = defaultLogger('Scheduler');

  const schedulerLogger: SchedulerLogger = {
    info: typeof logger?.info === 'function' ? logger.info.bind(logger) : fallback.info,
    warn: typeof logger?.warn === 'function' ? logger.warn.bind(logger) : fallback.warn,
    error: typeof logger?.error === 'function' ? logger.error.bind(logger) : fallback.error,
    debug: typeof logger?.debug === 'function' ? logger.debug.bind(logger) : fallback.debug
  };

  let tickInProgress = false;

  const tick = async () => {
    if (tickInProgress) {
      return;
    }

    tickInProgress = true;

    try {
      const settings = await getOrCreateSchedulerSettings();

      try {
        const [staleIngestion, staleSheets] = await Promise.all([
          markStaleIngestionRunsAsFailed(),
          markStaleSheetRunsAsFailed()
        ]);

        const recoveredManualRanges = await recoverRunningManualRangeRuns();

        if (staleIngestion > 0) {
          schedulerLogger.warn({ staleIngestion }, 'Auto-failed stale ingestion run(s).');
        }

        if (staleSheets > 0) {
          schedulerLogger.warn({ staleSheets }, 'Auto-failed stale sheet run(s).');
        }

        if (recoveredManualRanges > 0) {
          schedulerLogger.info({ recoveredManualRanges }, 'Recovered running manual sheets range run(s).');
        }
      } catch (error) {
        schedulerLogger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Scheduler stale/recovery step failed.'
        );
      }

      try {
        await runIngestionSchedulerTick(settings, schedulerLogger);
      } catch (error) {
        schedulerLogger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Ingestion scheduler step failed.'
        );
      }

      try {
        await runSheetsSchedulerTick(settings, schedulerLogger);
      } catch (error) {
        schedulerLogger.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Sheets scheduler step failed.'
        );
      }
    } catch (error) {
      schedulerLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Scheduler tick failed.');
    } finally {
      tickInProgress = false;
    }
  };

  const intervalId = setInterval(() => {
    void tick();
  }, env.SCHEDULER_POLL_SECONDS * 1000);

  if (typeof intervalId.unref === 'function') {
    intervalId.unref();
  }

  void tick();

  schedulerLogger.info(
    {
      pollSeconds: env.SCHEDULER_POLL_SECONDS,
      catchupDays: env.SCHEDULER_CATCHUP_DAYS
    },
    'Scheduler started.'
  );

  return {
    stop: () => {
      clearInterval(intervalId);
      schedulerLogger.info({}, 'Scheduler stopped.');
    }
  };
}
