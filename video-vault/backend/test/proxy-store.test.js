import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MANIFEST_URL_BYTES,
  MAX_MANIFEST_URLS,
  getProxyHeaders,
  getProxyEntry,
  isProxyTargetAllowed,
  registerProxyUrls,
  saveProxyEntry,
} from '../lib/proxy-store.js';
import { UrlPolicyError } from '../lib/safe-fetch.js';

function makeEntry(overrides = {}) {
  const token = saveProxyEntry({
    url: overrides.url || 'https://media.example/master.m3u8#ignored',
    headers: overrides.headers || {
      Cookie: 'session=secret',
      Authorization: 'Bearer secret',
      'Proxy-Authorization': 'Basic secret',
      'X-Api-Key': 'custom-secret',
      'X-Amz-Security-Token': 'sts-secret',
      Referer: 'https://page.example/watch',
      'User-Agent': 'VideoVaultTest',
      Accept: '*/*',
    },
    mediaType: 'application/x-mpegURL',
  });
  return { token, entry: getProxyEntry(token) };
}

test('saveProxyEntry stores a canonical root URL and origin', () => {
  const { entry } = makeEntry();
  assert.ok(entry);
  assert.equal(entry.url, 'https://media.example/master.m3u8');
  assert.equal(entry.rootOrigin, 'https://media.example');
  assert.ok(entry.manifestUrls instanceof Set);
  assert.equal(entry.manifestUrls.size, 0);
});

test('root-origin targets are allowed while forged cross-origin targets are denied', () => {
  const { entry } = makeEntry();
  assert.equal(isProxyTargetAllowed(entry, entry.url), true);
  assert.equal(isProxyTargetAllowed(entry, 'https://media.example/other/segment.ts?x=1'), true);
  assert.equal(isProxyTargetAllowed(entry, 'https://attacker.example/segment.ts'), false);
});

test('registered cross-origin targets require exact path/query but ignore fragments', () => {
  const { token, entry } = makeEntry();
  registerProxyUrls(token, ['https://cdn.example/segment.ts?sig=abc#part']);

  assert.equal(isProxyTargetAllowed(entry, 'https://cdn.example/segment.ts?sig=abc'), true);
  assert.equal(isProxyTargetAllowed(entry, 'https://cdn.example/segment.ts?sig=abc#other'), true);
  assert.equal(isProxyTargetAllowed(entry, 'https://cdn.example/segment.ts?sig=def'), false);
  assert.equal(isProxyTargetAllowed(entry, 'https://cdn.example/other.ts?sig=abc'), false);
});

test('registerProxyUrls is atomic when any URL is invalid', () => {
  const { token, entry } = makeEntry();
  assert.throws(
    () => registerProxyUrls(token, [
      'https://cdn.example/valid.ts',
      'file:///etc/passwd',
    ]),
    UrlPolicyError,
  );
  assert.equal(isProxyTargetAllowed(entry, 'https://cdn.example/valid.ts'), false);
  assert.equal(entry.manifestUrls.size, 0);
});

test('registerProxyUrls enforces the per-token cap without partial grants', () => {
  const { token, entry } = makeEntry();
  const tooMany = Array.from(
    { length: MAX_MANIFEST_URLS + 1 },
    (_, index) => `https://cdn.example/${index}.ts`,
  );
  assert.throws(
    () => registerProxyUrls(token, tooMany),
    (error) => error instanceof UrlPolicyError && error.code === 'MANIFEST_URL_LIMIT',
  );
  assert.equal(entry.manifestUrls.size, 0);
});

test('registerProxyUrls enforces a cumulative URL byte cap atomically', () => {
  const { token, entry } = makeEntry();
  const payloadLength = 8_000;
  const count = Math.ceil(MAX_MANIFEST_URL_BYTES / payloadLength) + 2;
  const urls = Array.from(
    { length: count },
    (_, index) => `https://cdn.example/${index}-${'x'.repeat(payloadLength - String(index).length)}`,
  );

  assert.throws(
    () => registerProxyUrls(token, urls),
    (error) => error instanceof UrlPolicyError && error.code === 'MANIFEST_URL_BYTES_LIMIT',
  );
  assert.equal(entry.manifestUrls.size, 0);
  assert.equal(entry.manifestUrlBytes, 0);
});

test('getProxyHeaders strips credentials cross-origin and preserves playback headers', () => {
  const { entry } = makeEntry();
  const sameOrigin = getProxyHeaders(entry, 'https://media.example/segment.ts');
  assert.equal(sameOrigin.Cookie, 'session=secret');
  assert.equal(sameOrigin.Authorization, 'Bearer secret');

  const crossOrigin = getProxyHeaders(entry, 'https://cdn.example/segment.ts');
  assert.equal(crossOrigin.Cookie, undefined);
  assert.equal(crossOrigin.Authorization, undefined);
  assert.equal(crossOrigin['Proxy-Authorization'], undefined);
  assert.equal(crossOrigin['X-Api-Key'], undefined);
  assert.equal(crossOrigin['X-Amz-Security-Token'], undefined);
  assert.equal(crossOrigin.Referer, 'https://page.example/watch');
  assert.equal(crossOrigin['User-Agent'], 'VideoVaultTest');
  assert.equal(crossOrigin.Accept, '*/*');

  assert.equal(entry.headers.Cookie, 'session=secret');
});

test('saveProxyEntry rejects a private or non-HTTP root capability', () => {
  assert.throws(
    () => saveProxyEntry({
      url: 'http://127.0.0.1/private',
      headers: {},
      mediaType: 'video/mp4',
    }),
    UrlPolicyError,
  );
  assert.throws(
    () => saveProxyEntry({
      url: 'file:///tmp/video.mp4',
      headers: {},
      mediaType: 'video/mp4',
    }),
    UrlPolicyError,
  );
});
