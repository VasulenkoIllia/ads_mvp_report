import assert from 'node:assert/strict';
import test from 'node:test';
import { GOOGLE_ADS_SCOPE, getMissingScopes, isInsufficientScopeError } from '../src/lib/google-scopes.ts';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

test('getMissingScopes returns empty when everything required was granted', () => {
  assert.deepEqual(
    getMissingScopes([GOOGLE_ADS_SCOPE, SHEETS_SCOPE, 'openid'], [GOOGLE_ADS_SCOPE, SHEETS_SCOPE]),
    []
  );
});

test('getMissingScopes reports scopes the user did not grant', () => {
  assert.deepEqual(getMissingScopes(['openid'], [GOOGLE_ADS_SCOPE, SHEETS_SCOPE]), [
    GOOGLE_ADS_SCOPE,
    SHEETS_SCOPE
  ]);
});

test('isInsufficientScopeError matches the real Google 403 payload (2026-08-26 incident)', () => {
  const error = {
    response: {
      status: 403,
      data: {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          status: 'PERMISSION_DENIED'
        }
      }
    },
    message: 'Request failed with status code 403'
  };

  assert.equal(isInsufficientScopeError(error), true);
});

test('isInsufficientScopeError ignores ordinary permission 403s', () => {
  const error = {
    response: { status: 403, data: { error: { message: 'The caller does not have permission' } } }
  };

  assert.equal(isInsufficientScopeError(error), false);
});

test('isInsufficientScopeError ignores non-403 statuses', () => {
  assert.equal(
    isInsufficientScopeError({ response: { status: 429, data: 'insufficient authentication scopes' } }),
    false
  );
});
