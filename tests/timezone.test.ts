import assert from 'node:assert/strict';
import test from 'node:test';
import {
  daysBetweenInclusive,
  getCatchupRunDates,
  localDateTimeToUtc,
  parseDateOnlyToUtcDayStart,
  toDateOnlyString,
  toLocalDateParts
} from '../src/lib/timezone.ts';

test('parseDateOnlyToUtcDayStart parses valid date', () => {
  const parsed = parseDateOnlyToUtcDayStart('2026-03-11');
  assert.equal(parsed.toISOString(), '2026-03-11T00:00:00.000Z');
});

test('parseDateOnlyToUtcDayStart rejects invalid date', () => {
  assert.throws(() => parseDateOnlyToUtcDayStart('2026-02-31'), /Invalid date value/);
});

test('daysBetweenInclusive returns inclusive number of days', () => {
  const start = parseDateOnlyToUtcDayStart('2026-03-01');
  const end = parseDateOnlyToUtcDayStart('2026-03-03');
  assert.equal(daysBetweenInclusive(start, end), 3);
});

test('getCatchupRunDates returns previous days in ascending order', () => {
  const now = new Date('2026-03-11T12:00:00.000Z');
  const dates = getCatchupRunDates(now, 'Europe/Kyiv', 3).map((value) => toDateOnlyString(value));

  assert.deepEqual(dates, ['2026-03-08', '2026-03-09', '2026-03-10']);
});

test('localDateTimeToUtc returns correct UTC for midnight in DST tz (ICU h23 quirk regression)', () => {
  // Regression test for the 2026-05-24 scheduler-loop incident.
  // Node 20 + ICU 78 with en-US + hourCycle:'h23' emits hour="24" at local
  // midnight, which used to shift localDateTimeToUtc by -24 hours.
  // Kyiv EEST = UTC+3 in May → 00:00 Kyiv on May 26 must map to May 25 21:00 UTC.
  const localToday = { year: 2026, month: 5, day: 26 };
  const utc = localDateTimeToUtc(localToday, 0, 0, 'Europe/Kyiv');
  assert.equal(utc.toISOString(), '2026-05-25T21:00:00.000Z');
});

test('toLocalDateParts returns correct date for current Kyiv day', () => {
  // Sanity check that the day reported by the formatter is correct
  // around midnight (should not slip by a day when hour overflows to 24).
  const utcAtKyivMidnight = new Date('2026-05-25T21:00:00.000Z');
  const parts = toLocalDateParts(utcAtKyivMidnight, 'Europe/Kyiv');
  assert.deepEqual(parts, { year: 2026, month: 5, day: 26 });
});
