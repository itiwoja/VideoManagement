import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyExtractInitialError,
  classifyExtractRuntimeError,
  classifyStreamTargetError,
} from '../lib/http-policy.js';
import { UrlPolicyError } from '../lib/safe-fetch.js';

test('extract initial URL errors distinguish malformed input from blocked destinations', () => {
  assert.deepEqual(
    classifyExtractInitialError(new UrlPolicyError('INVALID_URL')),
    { status: 400, message: 'invalid url' },
  );
  assert.deepEqual(
    classifyExtractInitialError(new UrlPolicyError('BLOCKED_ADDRESS')),
    { status: 403, message: 'url not allowed' },
  );
});

test('extract runtime policy failures never disclose derived URL details', () => {
  assert.deepEqual(
    classifyExtractRuntimeError(new UrlPolicyError('INVALID_URL', 'secret derived URL')),
    { status: 403, message: 'url not allowed' },
  );
  assert.deepEqual(
    classifyExtractRuntimeError(new Error('internal detail')),
    { status: 500, message: 'extract failed' },
  );
});

test('stream target classification separates malformed, forbidden, and upstream failures', () => {
  assert.deepEqual(
    classifyStreamTargetError(new UrlPolicyError('INVALID_PROXY_TARGET')),
    { status: 400, message: 'invalid sub-resource url' },
  );
  assert.deepEqual(
    classifyStreamTargetError(new UrlPolicyError('PROXY_TARGET_NOT_ALLOWED')),
    { status: 403, message: 'sub-resource url not allowed' },
  );
  assert.deepEqual(
    classifyStreamTargetError(new UrlPolicyError('MANIFEST_OUTPUT_TOO_LARGE')),
    { status: 502, message: 'upstream unavailable' },
  );
});
