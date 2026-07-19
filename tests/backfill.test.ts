import assert from 'node:assert/strict';
import test from 'node:test';
import { calcBackfillRange } from '../src/modules/backfill/backfill.service.ts';
import { parseDateOnlyToUtcDayStart, toDateOnlyString } from '../src/lib/timezone.ts';

const d = (value: string) => parseDateOnlyToUtcDayStart(value);

test('calcBackfillRange: anchor − lookback, within cap', () => {
  const r = calcBackfillRange({ anchor: d('2026-07-10'), yesterday: d('2026-07-17'), lookbackDays: 2, maxDays: 90 });
  assert.ok(r);
  assert.equal(toDateOnlyString(r.fromDate), '2026-07-08');
  assert.equal(toDateOnlyString(r.toDate), '2026-07-17');
  assert.equal(r.daysTotal, 10);
});

test('calcBackfillRange: clamped by maxDays when anchor is very old', () => {
  const r = calcBackfillRange({ anchor: d('2026-01-01'), yesterday: d('2026-07-17'), lookbackDays: 2, maxDays: 30 });
  assert.ok(r);
  assert.equal(toDateOnlyString(r.fromDate), '2026-06-18');
  assert.equal(r.daysTotal, 30);
});

test('calcBackfillRange: null anchor falls back to maxDays window', () => {
  const r = calcBackfillRange({ anchor: null, yesterday: d('2026-07-17'), lookbackDays: 2, maxDays: 7 });
  assert.ok(r);
  assert.equal(toDateOnlyString(r.fromDate), '2026-07-11');
  assert.equal(r.daysTotal, 7);
});

test('calcBackfillRange: anchor at yesterday with lookback 0 → single re-refresh day', () => {
  const r = calcBackfillRange({ anchor: d('2026-07-17'), yesterday: d('2026-07-17'), lookbackDays: 0, maxDays: 90 });
  assert.ok(r);
  assert.equal(toDateOnlyString(r.fromDate), '2026-07-17');
  assert.equal(r.daysTotal, 1);
});

test('calcBackfillRange: anchor newer than yesterday → null (already up to date)', () => {
  const r = calcBackfillRange({ anchor: d('2026-07-18'), yesterday: d('2026-07-17'), lookbackDays: 0, maxDays: 90 });
  assert.equal(r, null);
});
