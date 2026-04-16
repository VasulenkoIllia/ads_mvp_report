import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractGoogleAdsRetryAfterSeconds,
  formatGoogleAdsQuotaMessage,
  isGoogleAdsQuotaErrorSource,
  parseGoogleAdsQuotaExhaustedMeta
} from '../src/lib/google-ads-quota.ts';

test('extractGoogleAdsRetryAfterSeconds reads retryDelay duration', () => {
  const payload = [
    {
      error: {
        details: [
          {
            errors: [
              {
                message: 'Too many requests. Retry in 4280 seconds.',
                details: {
                  quotaErrorDetails: {
                    retryDelay: '4280s'
                  }
                }
              }
            ]
          }
        ]
      }
    }
  ];

  assert.equal(extractGoogleAdsRetryAfterSeconds(payload), 4280);
});

test('extractGoogleAdsRetryAfterSeconds reads retryAfter marker from plain text', () => {
  const text = 'Google Ads quota exhausted; retryAfter=613s; rateScope=DEVELOPER';
  assert.equal(extractGoogleAdsRetryAfterSeconds(text), 613);
});

test('parseGoogleAdsQuotaExhaustedMeta parses 429 quota payload', () => {
  const error = {
    message: 'Request failed with status code 429',
    response: {
      status: 429,
      data: [
        {
          error: {
            status: 'RESOURCE_EXHAUSTED',
            details: [
              {
                requestId: 'abc123',
                errors: [
                  {
                    errorCode: { quotaError: 'RESOURCE_EXHAUSTED' },
                    details: {
                      quotaErrorDetails: {
                        rateScope: 'DEVELOPER',
                        rateName: 'Number of operations for basic access',
                        retryDelay: '4200s'
                      }
                    }
                  }
                ]
              }
            ]
          }
        }
      ]
    }
  };

  const parsed = parseGoogleAdsQuotaExhaustedMeta(error);
  assert.equal(parsed?.retryAfterSeconds, 4200);
  assert.equal(parsed?.rateScope, 'DEVELOPER');
  assert.equal(parsed?.rateName, 'Number of operations for basic access');
  assert.equal(parsed?.requestId, 'abc123');
});

test('parseGoogleAdsQuotaExhaustedMeta ignores non-429 errors', () => {
  const error = {
    message: 'Request failed with status code 500',
    response: {
      status: 500,
      data: {
        error: {
          message: 'Internal error'
        }
      }
    }
  };

  assert.equal(parseGoogleAdsQuotaExhaustedMeta(error), null);
});

test('isGoogleAdsQuotaErrorSource detects RESOURCE_EXHAUSTED marker', () => {
  assert.equal(isGoogleAdsQuotaErrorSource('status=RESOURCE_EXHAUSTED'), true);
  assert.equal(isGoogleAdsQuotaErrorSource('status=INTERNAL'), false);
});

test('formatGoogleAdsQuotaMessage includes normalized fields', () => {
  const message = formatGoogleAdsQuotaMessage({
    retryAfterSeconds: 4200,
    rateScope: 'DEVELOPER',
    rateName: 'Number of operations for basic access',
    requestId: 'abc123'
  });

  assert.match(message, /retryAfter=4200s/);
  assert.match(message, /rateScope=DEVELOPER/);
  assert.match(message, /requestId=abc123/);
});
