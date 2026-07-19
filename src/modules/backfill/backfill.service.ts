import {
  BackfillStatus,
  BackfillTrigger,
  IngestionRunStatus,
  OAuthConnectionStatus,
  SheetRunStatus,
  TriggerSource
} from '@prisma/client';
import { env } from '../../config/env.js';
import { ApiError } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import {
  addUtcDays,
  getDefaultYesterdayRunDate,
  getUtcDayWindow,
  toDateOnlyString
} from '../../lib/timezone.js';
import { runGoogleAdsIngestion } from '../ingestion/ingestion.service.js';
import { runSheetExportConfigById } from '../sheets/sheets.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'Europe/Kyiv';
// Hard backstop against a runaway worker loop. A full run is ~2*daysTotal
// iterations (ingest + export phases); 5000 covers the 365-day cap with slack.
const MAX_WORKER_ITERATIONS = 5000;

let workerBusy = false;

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log('[Backfill]', message);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const reason =
      error.details && typeof error.details === 'object' && 'reason' in error.details
        ? ` (${String((error.details as { reason?: unknown }).reason)})`
        : '';
    return `${error.message}${reason}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, max = 1000): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

async function getOrCreateState() {
  return prisma.backfillState.upsert({
    where: { id: 'GLOBAL' },
    create: { id: 'GLOBAL', status: BackfillStatus.IDLE },
    update: {}
  });
}

export async function getBackfillState() {
  return getOrCreateState();
}

/**
 * Pure window math (no DB) so it is unit-testable. Derive the catch-up window
 * from the freshest data day we already have, NOT from a fixed rolling window:
 * fromDate = (anchor − lookback buffer), toDate = yesterday. Bounded by maxDays
 * so an empty DB / very old anchor can never explode into a year-long backfill.
 * Returns null when already up to date.
 */
export function calcBackfillRange(params: {
  anchor: Date | null;
  yesterday: Date;
  lookbackDays: number;
  maxDays: number;
}): { fromDate: Date; toDate: Date; daysTotal: number } | null {
  const toDate = params.yesterday;
  const cap = addUtcDays(toDate, -(params.maxDays - 1));

  let fromDate = params.anchor ? addUtcDays(params.anchor, -params.lookbackDays) : cap;
  if (fromDate.getTime() < cap.getTime()) {
    fromDate = cap;
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return null;
  }

  const daysTotal = Math.floor((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  return { fromDate, toDate, daysTotal };
}

async function computeRange(
  now: Date
): Promise<{ fromDate: Date; toDate: Date; daysTotal: number } | null> {
  const agg = await prisma.campaignDailyFact.aggregate({ _max: { factDate: true } });
  return calcBackfillRange({
    anchor: agg._max.factDate,
    yesterday: getDefaultYesterdayRunDate(now, TZ),
    lookbackDays: env.BACKFILL_LOOKBACK_DAYS,
    maxDays: env.BACKFILL_MAX_DAYS
  });
}

async function isConnectionReady(): Promise<boolean> {
  const connection = await prisma.googleOAuthConnection.findUnique({
    where: { id: 'GOOGLE' },
    select: { status: true, encryptedRefreshToken: true }
  });
  return Boolean(
    connection && connection.status === OAuthConnectionStatus.ACTIVE && connection.encryptedRefreshToken
  );
}

async function hasCompletedIngestion(day: Date): Promise<boolean> {
  const window = getUtcDayWindow(day);
  const existing = await prisma.ingestionRun.findFirst({
    where: {
      runDate: { gte: window.start, lt: window.end },
      status: { in: [IngestionRunStatus.SUCCESS, IngestionRunStatus.PARTIAL] }
    },
    select: { id: true }
  });
  return Boolean(existing);
}

async function hasCompletedSheet(configId: string, day: Date): Promise<boolean> {
  const window = getUtcDayWindow(day);
  const existing = await prisma.sheetExportRun.findFirst({
    where: {
      configId,
      runDate: { gte: window.start, lt: window.end },
      status: { in: [SheetRunStatus.SUCCESS, SheetRunStatus.PARTIAL, SheetRunStatus.SKIPPED] }
    },
    select: { id: true }
  });
  return Boolean(existing);
}

async function countActiveConfigs(): Promise<number> {
  return prisma.accountSheetConfig.count({ where: { active: true } });
}

type ErrorAction = 'pause' | 'no-accounts' | 'transient';

function classifyIngestionError(error: unknown): ErrorAction {
  if (error instanceof ApiError) {
    if (error.errorCode === 'GOOGLE_ADS_QUOTA_EXHAUSTED') {
      return 'pause';
    }
    const message = error.message.toLowerCase();
    if (
      message.includes('not ready') ||
      message.includes('still running') ||
      message.includes('quota cooldown') ||
      message.includes('another ingestion start')
    ) {
      return 'pause';
    }
    if (error.statusCode === 404 || message.includes('no eligible')) {
      return 'no-accounts';
    }
  }
  return 'transient';
}

function isSheetPause(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  if (error.errorCode === 'GOOGLE_SHEETS_QUOTA_EXHAUSTED') {
    return true;
  }
  const reason =
    error.details && typeof error.details === 'object' && 'reason' in error.details
      ? String((error.details as { reason?: unknown }).reason)
      : '';
  const haystack = `${error.message} ${reason}`.toLowerCase();
  return (
    haystack.includes('not connected') ||
    haystack.includes('reconnect') ||
    haystack.includes('reauth') ||
    haystack.includes('token refresh') ||
    haystack.includes('scope')
  );
}

async function noteError(error: unknown): Promise<void> {
  await prisma.backfillState.update({
    where: { id: 'GLOBAL' },
    data: { lastError: truncate(toErrorMessage(error)) }
  });
}

async function finish(reason: string, isError = false): Promise<void> {
  await prisma.backfillState.update({
    where: { id: 'GLOBAL' },
    data: {
      status: BackfillStatus.IDLE,
      finishedAt: new Date(),
      cursorDate: null,
      cursorAttempts: 0,
      lastError: isError ? truncate(reason) : null
    }
  });
  log(`finished: ${reason}`);
}

async function advanceCursor(cursor: Date): Promise<void> {
  await prisma.backfillState.update({
    where: { id: 'GLOBAL' },
    // lastError: null — a completed day clears stale pause/transient notes.
    data: { cursorDate: addUtcDays(cursor, 1), cursorAttempts: 0, daysDone: { increment: 1 }, lastError: null }
  });
}

async function stepIngestDay(cursorAttempts: number, cursor: Date): Promise<boolean> {
  const dayText = toDateOnlyString(cursor);

  if (await hasCompletedIngestion(cursor)) {
    await advanceCursor(cursor);
    return true;
  }

  try {
    // MANUAL on purpose: the scheduler counts SCHEDULER-sourced runs toward
    // ingestionMaxDailyAttempts, so backfill retries as SCHEDULER could exhaust
    // the nightly catchup budget for a date. MANUAL failures don't consume that
    // budget, while a MANUAL SUCCESS/PARTIAL still marks the date complete for
    // the catchup check (completedAny is source-agnostic for catchup dates).
    const result = await runGoogleAdsIngestion({
      runDate: dayText,
      triggerSource: TriggerSource.MANUAL,
      enabledOnly: true
    });
    log(
      `ingest ${dayText}: ${result.run.status} rows=${result.run.rowsUpserted} failed=${result.run.failedAccounts}`
    );
    await advanceCursor(cursor);
    return true;
  } catch (error) {
    const action = classifyIngestionError(error);

    if (action === 'pause') {
      await noteError(error);
      log(`paused at ${dayText}: ${toErrorMessage(error)}`);
      return false;
    }

    if (action === 'no-accounts') {
      await finish('no eligible accounts to ingest');
      return false;
    }

    const attempts = cursorAttempts + 1;
    if (attempts >= env.BACKFILL_DAY_MAX_ATTEMPTS) {
      log(`ingest ${dayText} failed ${attempts}x — skipping: ${toErrorMessage(error)}`);
      await advanceCursor(cursor);
      return true;
    }

    await prisma.backfillState.update({
      where: { id: 'GLOBAL' },
      data: { cursorAttempts: attempts, lastError: truncate(toErrorMessage(error)) }
    });
    log(`ingest ${dayText} transient error (attempt ${attempts}) — will retry: ${toErrorMessage(error)}`);
    return false;
  }
}

async function stepExportDay(cursor: Date): Promise<boolean> {
  const dayText = toDateOnlyString(cursor);
  const configs = await prisma.accountSheetConfig.findMany({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true }
  });

  for (const config of configs) {
    if (await hasCompletedSheet(config.id, cursor)) {
      continue;
    }
    try {
      // SCHEDULER on purpose (unlike the ingestion phase): the sheets scheduler
      // recognizes completed days ONLY among SCHEDULER-sourced runs, so MANUAL
      // here would make the nightly tick re-export every backfilled day inside
      // its catchup window — wasted Sheets quota for zero data change.
      await runSheetExportConfigById({
        configId: config.id,
        runDate: cursor,
        triggerSource: TriggerSource.SCHEDULER
      });
    } catch (error) {
      if (isSheetPause(error)) {
        await noteError(error);
        log(`sheets paused at ${dayText} (config ${config.id}): ${toErrorMessage(error)}`);
        return false;
      }
      log(`sheets export ${dayText} (config ${config.id}) failed: ${toErrorMessage(error)}`);
    }
  }

  await advanceCursor(cursor);
  return true;
}

async function step(): Promise<boolean> {
  const state = await getOrCreateState();

  if (state.status === BackfillStatus.IDLE) {
    return false;
  }

  if (state.status === BackfillStatus.REQUESTED) {
    const range = await computeRange(new Date());
    if (!range) {
      await finish('nothing to backfill (already up to date)');
      return false;
    }
    await prisma.backfillState.update({
      where: { id: 'GLOBAL' },
      data: {
        status: BackfillStatus.INGESTING,
        fromDate: range.fromDate,
        toDate: range.toDate,
        cursorDate: range.fromDate,
        cursorAttempts: 0,
        daysTotal: range.daysTotal,
        daysDone: 0,
        startedAt: new Date(),
        finishedAt: null,
        lastError: null
      }
    });
    log(`start ${toDateOnlyString(range.fromDate)}..${toDateOnlyString(range.toDate)} (${range.daysTotal} day(s))`);
    return true;
  }

  // INGESTING / EXPORTING both require a live connection. If the token died
  // again mid-catch-up, pause here (cursor is NOT advanced) and resume on the
  // next re-auth / scheduler kick. Persist the reason so the UI can show why
  // the pass is sitting still instead of looking like an endless run.
  if (!(await isConnectionReady())) {
    const pauseNote = 'Пауза: Google-підключення неактивне — очікує оновлення токена.';
    if (state.lastError !== pauseNote) {
      await prisma.backfillState.update({ where: { id: 'GLOBAL' }, data: { lastError: pauseNote } });
    }
    log('paused: Google connection not ready (waiting for re-auth)');
    return false;
  }

  const cursor = state.cursorDate ?? state.fromDate;
  const toDate = state.toDate;
  if (!cursor || !toDate) {
    await finish('invalid state (missing cursor/toDate)', true);
    return false;
  }

  if (state.status === BackfillStatus.INGESTING) {
    if (cursor.getTime() > toDate.getTime()) {
      if ((await countActiveConfigs()) === 0) {
        await finish('done — ingestion only (no active sheet configs)');
        return false;
      }
      await prisma.backfillState.update({
        where: { id: 'GLOBAL' },
        data: {
          status: BackfillStatus.EXPORTING,
          cursorDate: state.fromDate,
          cursorAttempts: 0,
          daysDone: 0
        }
      });
      log('ingestion phase complete → sheets export phase');
      return true;
    }
    return stepIngestDay(state.cursorAttempts, cursor);
  }

  // EXPORTING
  if (cursor.getTime() > toDate.getTime()) {
    await finish('done — ingestion + sheets export');
    return false;
  }
  return stepExportDay(cursor);
}

async function runWorker(): Promise<void> {
  if (workerBusy) {
    return;
  }
  workerBusy = true;
  try {
    let iterations = 0;
    while (iterations < MAX_WORKER_ITERATIONS) {
      iterations += 1;
      let shouldContinue: boolean;
      try {
        shouldContinue = await step();
      } catch (error) {
        log(`worker step crashed: ${toErrorMessage(error)}`);
        await noteError(error).catch(() => undefined);
        break;
      }
      if (!shouldContinue) {
        break;
      }
    }
    if (iterations >= MAX_WORKER_ITERATIONS) {
      log('worker stopped: hit MAX_WORKER_ITERATIONS safety cap');
    }
  } finally {
    workerBusy = false;
  }
}

function kickWorker(): void {
  if (!env.BACKFILL_ENABLED) {
    return;
  }
  void runWorker();
}

/**
 * Request a catch-up pass. Called on token re-auth (trigger REAUTH) and from the
 * manual "backfill now" endpoint (trigger MANUAL). No-op unless BACKFILL_ENABLED.
 */
export async function requestBackfill(
  trigger: BackfillTrigger
): Promise<{ requested: boolean; reason?: string }> {
  if (!env.BACKFILL_ENABLED) {
    return { requested: false, reason: 'Автодовантаження вимкнено (BACKFILL_ENABLED=false).' };
  }

  await getOrCreateState();

  // Anti-spam: never restart on top of an in-flight pass (REQUESTED/INGESTING/
  // EXPORTING, incl. paused). The IDLE check is part of the UPDATE's WHERE so
  // two concurrent requests cannot both claim the slot (atomic check-and-set);
  // the loser just re-kicks the worker so a paused pass resumes.
  const claimed = await prisma.backfillState.updateMany({
    where: { id: 'GLOBAL', status: BackfillStatus.IDLE },
    data: {
      status: BackfillStatus.REQUESTED,
      trigger,
      requestedAt: new Date(),
      finishedAt: null,
      lastError: null,
      cursorDate: null,
      cursorAttempts: 0,
      daysDone: 0
    }
  });

  if (claimed.count === 0) {
    kickWorker();
    return { requested: false, reason: 'Довантаження вже виконується.' };
  }

  log(`requested (${trigger})`);
  kickWorker();
  return { requested: true };
}

/**
 * Re-kick the worker if a pass is in flight (e.g. after a process restart or a
 * pause). Called every scheduler tick, mirroring recoverRunningManualRangeRuns.
 */
export async function recoverBackfill(): Promise<void> {
  if (!env.BACKFILL_ENABLED) {
    return;
  }
  const state = await prisma.backfillState.findUnique({
    where: { id: 'GLOBAL' },
    select: { status: true }
  });
  if (state && state.status !== BackfillStatus.IDLE) {
    kickWorker();
  }
}
