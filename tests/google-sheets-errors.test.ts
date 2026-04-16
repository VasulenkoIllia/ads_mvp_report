import assert from 'node:assert/strict';
import test from 'node:test';
import { isGoogleSheetsAddSheetAlreadyExistsError } from '../src/lib/google-sheets-errors.ts';

test('isGoogleSheetsAddSheetAlreadyExistsError detects english payload', () => {
  const error = {
    message: 'Request failed with status code 400',
    response: {
      status: 400,
      data: {
        error: {
          code: 400,
          message: 'Invalid requests[0].addSheet: Sheet "daily" already exists.',
          status: 'INVALID_ARGUMENT'
        }
      }
    }
  };

  assert.equal(isGoogleSheetsAddSheetAlreadyExistsError(error), true);
});

test('isGoogleSheetsAddSheetAlreadyExistsError detects russian payload', () => {
  const error = {
    message: 'Request failed with status code 400',
    response: {
      status: 400,
      data: {
        error: {
          code: 400,
          message: 'Invalid requests[0].addSheet: Лист "daily" уже существует. Введите другое название.',
          status: 'INVALID_ARGUMENT'
        }
      }
    }
  };

  assert.equal(isGoogleSheetsAddSheetAlreadyExistsError(error), true);
});

test('isGoogleSheetsAddSheetAlreadyExistsError ignores other addSheet validation errors', () => {
  const error = {
    message: 'Request failed with status code 400',
    response: {
      status: 400,
      data: {
        error: {
          code: 400,
          message: 'Invalid requests[0].addSheet: Invalid sheet title.',
          status: 'INVALID_ARGUMENT'
        }
      }
    }
  };

  assert.equal(isGoogleSheetsAddSheetAlreadyExistsError(error), false);
});
