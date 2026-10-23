import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorMessage } from '../src/editor/apiErrors.js';

test('422 errors identify the field and validation message', () => {
  assert.equal(apiErrorMessage({ detail: [{ loc: ['body', 'document', 'subtitles', 1], msg: 'Value error, Words must be inside their caption' }] }, 422),
    'document.subtitles.1: Words must be inside their caption');
});
test('API error messages retain server details or HTTP status', () => {
  assert.equal(apiErrorMessage({ detail: 'Not authenticated' }, 401), 'Not authenticated');
  assert.match(apiErrorMessage({}, 503), /HTTP 503/);
});
