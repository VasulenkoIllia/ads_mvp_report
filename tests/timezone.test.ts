import assert from 'node:assert/strict';
import test from 'node:test';
import {
  daysBetweenInclusive,
  getCatchupRunDates,
  parseDateOnlyToUtcDayStart,
  toDateOnlyString
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
