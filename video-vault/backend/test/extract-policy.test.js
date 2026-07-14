import assert from 'node:assert/strict';
import test from 'node:test';

import { extractMedia, extractMetadata } from '../lib/extract.js';
import { UrlPolicyError } from '../lib/safe-fetch.js';

function assertInvalidUrl(error) {
  return error instanceof UrlPolicyError && error.code === 'INVALID_URL';
}

test('extractMedia rejects non-HTTP URLs before any extractor runs', async () => {
  await assert.rejects(
    extractMedia('file:///etc/passwd'),
    assertInvalidUrl,
  );
});

test('extractMetadata rejects non-HTTP URLs before any extractor runs', async () => {
  await assert.rejects(
    extractMetadata('file:///etc/passwd'),
    assertInvalidUrl,
  );
});
