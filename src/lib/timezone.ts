const DAY_MS = 24 * 60 * 60 * 1000;

export type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

type LocalDateTimeParts = LocalDateParts & {
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  });

  formatterCache.set(timezone, formatter);
  return formatter;
}

function getLocalDateTimeParts(date: Date, timezone: string): LocalDateTimeParts {
  const parts = getFormatter(timezone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second')
  };
}

export function toLocalDateParts(date: Date, timezone: string): LocalDateParts {
  const local = getLocalDateTimeParts(date, timezone);
  return {
    year: local.year,
    month: local.month,
    day: local.day
  };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const local = getLocalDateTimeParts(date, timezone);
  const utcMsFromLocal = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second, 0);
  return utcMsFromLocal - date.getTime();
}

export function localDateTimeToUtc(date: LocalDateParts, hour: number, minute: number, timezone: string): Date {
  let resolved = new Date(Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offsetMs = getTimezoneOffsetMs(resolved, timezone);
    const corrected = new Date(Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0) - offsetMs);
    if (Math.abs(corrected.getTime() - resolved.getTime()) < 1000) {
      return corrected;
    }
    resolved = corrected;
  }

  return resolved;
}

export function addDaysToLocalDate(date: LocalDateParts, days: number): LocalDateParts {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 0, 0, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

export function localDateToUtcDayStart(date: LocalDateParts): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0, 0));
}

export function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDateOnlyToUtcDayStart(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Date must match YYYY-MM-DD');
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error('Invalid date value');
  }

  return parsed;
}

export function getUtcDayWindow(dayStart: Date): { start: Date; end: Date } {
  return {
    start: dayStart,
    end: new Date(dayStart.getTime() + DAY_MS)
  };
}

export function hasReachedScheduleTime(
  now: Date,
  schedule: { hour: number; minute: number },
  timezone: string
): boolean {
  const localDay = toLocalDateParts(now, timezone);
  const scheduledToday = localDateTimeToUtc(localDay, schedule.hour, schedule.minute, timezone);
  return now.getTime() >= scheduledToday.getTime();
}

export function getNextScheduledAt(
  now: Date,
  schedule: { hour: number; minute: number },
  timezone: string
): Date {
  const todayLocal = toLocalDateParts(now, timezone);
  const scheduledToday = localDateTimeToUtc(todayLocal, schedule.hour, schedule.minute, timezone);

  if (now.getTime() < scheduledToday.getTime()) {
    return scheduledToday;
  }

  const tomorrowLocal = addDaysToLocalDate(todayLocal, 1);
  return localDateTimeToUtc(tomorrowLocal, schedule.hour, schedule.minute, timezone);
}

export function getDefaultYesterdayRunDate(now: Date, timezone: string): Date {
  const todayLocal = toLocalDateParts(now, timezone);
  const yesterdayLocal = addDaysToLocalDate(todayLocal, -1);
  return localDateToUtcDayStart(yesterdayLocal);
}

export function getCatchupRunDates(now: Date, timezone: string, catchupDays: number): Date[] {
  const safeDays = Math.max(1, catchupDays);
  const todayLocal = toLocalDateParts(now, timezone);
  const result: Date[] = [];

  for (let offset = safeDays; offset >= 1; offset -= 1) {
    result.push(localDateToUtcDayStart(addDaysToLocalDate(todayLocal, -offset)));
  }

  return result;
}

export function addUtcDays(dayStart: Date, days: number): Date {
  return new Date(dayStart.getTime() + days * DAY_MS);
}

export function daysBetweenInclusive(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}
