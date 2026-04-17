import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractGoogleSheetsRetryAfterSeconds,
  formatGoogleSheetsQuotaMessage,
  parseGoogleSheetsQuotaExhaustedMeta,
  resolveGoogleSheetsQuotaRetryDelayMs
} from '../src/lib/google-sheets-quota.ts';

test('extractGoogleSheetsRetryAfterSeconds reads retryAfter marker', () => {
  const text = 'Google Sheets quota exhausted; retryAfter=61s';
  assert.equal(extractGoogleSheetsRetryAfterSeconds(text), 61);
});

test('parseGoogleSheetsQuotaExhaustedMeta parses read requests per minute payload', () => {
  const error = {
    message: 'Request failed with status code 429',
    response: {
      status: 429,
      data: {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'RATE_LIMIT_EXCEEDED',
              domain: 'googleapis.com',
              metadata: {
                quota_limit_value: '60',
                quota_metric: 'sheets.googleapis.com/read_requests',
                quota_limit: 'ReadRequestsPerMinutePerUser',
                quota_unit: '1/min/{project}/{user}'
              }
            }
          ]
        }
      }
    }
  };

  const parsed = parseGoogleSheetsQuotaExhaustedMeta(error);
  assert.equal(parsed?.quotaMetric, 'sheets.googleapis.com/read_requests');
  assert.equal(parsed?.quotaLimit, 'ReadRequestsPerMinutePerUser');
  assert.equal(parsed?.quotaLimitValue, 60);
});

test('resolveGoogleSheetsQuotaRetryDelayMs enforces 65s floor for read/min/user limit', () => {
  const delay = resolveGoogleSheetsQuotaRetryDelayMs(
    {
      retryAfterSeconds: null,
      quotaMetric: 'sheets.googleapis.com/read_requests',
      quotaLimit: 'ReadRequestsPerMinutePerUser',
      quotaLimitValue: 60,
      quotaUnit: '1/min/{project}/{user}',
      quotaLocation: null,
      service: 'sheets.googleapis.com',
      consumer: 'projects/123',
      reason: 'RATE_LIMIT_EXCEEDED'
    },
    1200
  );

  assert.equal(delay, 65_000);
});

test('resolveGoogleSheetsQuotaRetryDelayMs enforces 65s floor for write/min/user limit', () => {
  const delay = resolveGoogleSheetsQuotaRetryDelayMs(
    {
      retryAfterSeconds: null,
      quotaMetric: 'sheets.googleapis.com/write_requests',
      quotaLimit: 'WriteRequestsPerMinutePerUser',
      quotaLimitValue: 60,
      quotaUnit: '1/min/{project}/{user}',
      quotaLocation: null,
      service: 'sheets.googleapis.com',
      consumer: 'projects/123',
      reason: 'RATE_LIMIT_EXCEEDED'
    },
    900
  );

  assert.equal(delay, 65_000);
});

test('formatGoogleSheetsQuotaMessage includes normalized fields', () => {
  const message = formatGoogleSheetsQuotaMessage({
    retryAfterSeconds: 61,
    quotaMetric: 'sheets.googleapis.com/read_requests',
    quotaLimit: 'ReadRequestsPerMinutePerUser',
    quotaLimitValue: 60,
    quotaUnit: null,
    quotaLocation: null,
    service: null,
    consumer: null,
    reason: 'RATE_LIMIT_EXCEEDED'
  });

  assert.match(message, /retryAfter=61s/);
  assert.match(message, /quotaMetric=sheets\.googleapis\.com\/read_requests/);
  assert.match(message, /quotaLimit=ReadRequestsPerMinutePerUser/);
});
