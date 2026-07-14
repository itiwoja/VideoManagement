import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_REFERENCES,
  MAX_REWRITTEN_MANIFEST_BYTES,
  decodeProxyTarget,
  encodeProxyTarget,
  getRawProxyTargetQuery,
  prepareHlsManifest,
  readManifestText,
  resolveProxyTarget,
} from '../lib/hls-proxy.js';
import { UrlPolicyError } from '../lib/safe-fetch.js';
import {
  getProxyEntry,
  isProxyTargetAllowed,
  registerProxyUrls,
  saveProxyEntry,
} from '../lib/proxy-store.js';

test('proxy target encoding is canonical base64url and round-trips without fragments', () => {
  const encoded = encodeProxyTarget('https://cdn.example/video.ts?sig=a+b/c#ignored');
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.equal(encoded.includes('='), false);
  assert.equal(
    decodeProxyTarget(encoded).href,
    'https://cdn.example/video.ts?sig=a+b/c',
  );
});

test('decodeProxyTarget rejects non-canonical aliases and malformed values', () => {
  const canonical = encodeProxyTarget('https://cdn.example/video.ts');
  const invalidUtf8 = Buffer.from([0xff]).toString('base64url');
  for (const encoded of [
    '',
    `${canonical}=`,
    `${canonical}%`,
    `${canonical} `,
    `${canonical}/`,
    `${canonical}+`,
    'a',
    invalidUtf8,
    'x'.repeat(20_000),
  ]) {
    assert.throws(() => decodeProxyTarget(encoded), UrlPolicyError, encoded.slice(0, 40));
  }
});

test('decodeProxyTarget rejects decoded non-HTTP or private targets', () => {
  for (const raw of ['file:///etc/passwd', 'http://127.0.0.1/admin']) {
    const encoded = Buffer.from(raw, 'utf8').toString('base64url');
    assert.throws(() => decodeProxyTarget(encoded), UrlPolicyError, raw);
  }
});

test('getRawProxyTargetQuery accepts only one canonical wire value', () => {
  const canonical = encodeProxyTarget('https://cdn.example/video.ts');
  assert.equal(
    getRawProxyTargetQuery(`/api/stream/token?other=1&u=${canonical}`, canonical),
    canonical,
  );
  assert.equal(
    getRawProxyTargetQuery('/api/stream/token?other=1', undefined),
    undefined,
  );

  for (const [url, parsed] of [
    [
      `/api/stream/token?u=%${canonical.charCodeAt(0).toString(16)}${canonical.slice(1)}`,
      canonical,
    ],
    [`/api/stream/token?%75=${canonical}`, canonical],
    [`/api/stream/token?u=${canonical}&u=${canonical}`, [canonical, canonical]],
    ['/api/stream/token?u', ''],
    [`/api/stream/token?u[]=${canonical}`, [canonical]],
    [`/api/stream/token?u[x]=${canonical}`, { x: canonical }],
  ]) {
    assert.throws(
      () => getRawProxyTargetQuery(url, parsed),
      (error) => error instanceof UrlPolicyError && error.code === 'INVALID_PROXY_TARGET',
      url,
    );
  }
});

test('prepareHlsManifest rewrites media lines and URI attributes transactionally', () => {
  const source = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin?token=1"',
    '#EXT-X-MAP:URI="https://assets.example/init.mp4"',
    '#EXTINF:6,',
    'segments/0001.ts?sig=abc',
    '',
  ].join('\n');

  const prepared = prepareHlsManifest(
    source,
    'https://media.example/path/master.m3u8',
    'parent-token',
  );

  assert.deepEqual(prepared.urls.sort(), [
    'https://assets.example/init.mp4',
    'https://media.example/path/keys/key.bin?token=1',
    'https://media.example/path/segments/0001.ts?sig=abc',
  ]);
  assert.match(prepared.text, /\/api\/stream\/parent-token\?u=[A-Za-z0-9_-]+/);
  assert.equal(prepared.text.includes('segments/0001.ts'), false);
  assert.equal(prepared.text.includes('keys/key.bin'), false);
});

test('prepareHlsManifest rejects an unsafe URI without producing a partial result', () => {
  const source = [
    '#EXTM3U',
    'https://cdn.example/valid.ts',
    '#EXT-X-KEY:METHOD=AES-128,URI="file:///etc/passwd"',
  ].join('\n');
  assert.throws(
    () => prepareHlsManifest(source, 'https://media.example/master.m3u8', 'token'),
    UrlPolicyError,
  );
});

test('nested manifests grant each cross-origin child only after its parent is processed', () => {
  const token = saveProxyEntry({
    url: 'https://media.example/master.m3u8',
    headers: {},
    mediaType: 'application/x-mpegURL',
  });
  const entry = getProxyEntry(token);

  const master = prepareHlsManifest(
    '#EXTM3U\nhttps://variants.example/720p/index.m3u8?sig=master',
    entry.url,
    token,
  );
  const variantUrl = 'https://variants.example/720p/index.m3u8?sig=master';
  assert.equal(isProxyTargetAllowed(entry, variantUrl), false);
  registerProxyUrls(token, master.urls);
  assert.equal(isProxyTargetAllowed(entry, variantUrl), true);

  const variant = prepareHlsManifest(
    [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/key.bin?sig=key"',
      'segments/one.ts?sig=segment',
    ].join('\n'),
    variantUrl,
    token,
  );
  const segmentUrl = 'https://variants.example/720p/segments/one.ts?sig=segment';
  const keyUrl = 'https://keys.example/key.bin?sig=key';
  assert.equal(isProxyTargetAllowed(entry, segmentUrl), false);
  assert.equal(isProxyTargetAllowed(entry, keyUrl), false);
  registerProxyUrls(token, variant.urls);
  assert.equal(isProxyTargetAllowed(entry, segmentUrl), true);
  assert.equal(isProxyTargetAllowed(entry, keyUrl), true);
  assert.equal(isProxyTargetAllowed(entry, 'https://keys.example/key.bin?sig=changed'), false);
});

test('prepareHlsManifest resolves relative URLs against the final fetched URL', () => {
  const prepared = prepareHlsManifest(
    '#EXTM3U\nsegment.ts',
    'https://redirected.example/final/path/index.m3u8',
    'token',
  );
  assert.deepEqual(prepared.urls, [
    'https://redirected.example/final/path/segment.ts',
  ]);
});

test('prepareHlsManifest rejects text larger than the manifest byte cap', () => {
  assert.throws(
    () => prepareHlsManifest(
      'x'.repeat(MAX_MANIFEST_BYTES + 1),
      'https://media.example/master.m3u8',
      'token',
    ),
    (error) => error instanceof UrlPolicyError && error.code === 'MANIFEST_TOO_LARGE',
  );
});

test('prepareHlsManifest requires an HLS header before granting URLs', () => {
  assert.throws(
    () => prepareHlsManifest(
      'https://attacker.example/not-really-a-manifest',
      'https://media.example/master.m3u8',
      'token',
    ),
    (error) => error instanceof UrlPolicyError && error.code === 'INVALID_HLS_MANIFEST',
  );
});

test('prepareHlsManifest caps repeated references even when URLs are duplicated', () => {
  const source = `#EXTM3U\n${'a\n'.repeat(MAX_MANIFEST_REFERENCES + 1)}`;
  assert.throws(
    () => prepareHlsManifest(source, 'https://media.example/master.m3u8', 'token'),
    (error) => error instanceof UrlPolicyError && error.code === 'MANIFEST_REFERENCE_LIMIT',
  );
});

test('prepareHlsManifest caps rewritten output expansion', () => {
  const longBase = `https://media.example/${'x'.repeat(8_000)}/master.m3u8`;
  const repetitions = Math.ceil(MAX_REWRITTEN_MANIFEST_BYTES / 10_000) + 10;
  const source = `#EXTM3U\n${'a\n'.repeat(repetitions)}`;
  assert.throws(
    () => prepareHlsManifest(source, longBase, 'token'),
    (error) => error instanceof UrlPolicyError && error.code === 'MANIFEST_OUTPUT_TOO_LARGE',
  );
});

test('prepareHlsManifest caps a single tag line while rewriting URI attributes', () => {
  const longBase = `https://media.example/${'x'.repeat(8_000)}/master.m3u8`;
  const source = `#EXTM3U\n#EXT-X-SESSION-DATA:${'URI="a",'.repeat(500)}`;
  assert.throws(
    () => prepareHlsManifest(source, longBase, 'token'),
    (error) => error instanceof UrlPolicyError && error.code === 'MANIFEST_OUTPUT_TOO_LARGE',
  );
});

test('readManifestText enforces declared and streamed byte limits', async () => {
  await assert.rejects(
    readManifestText(new Response('12345', {
      headers: { 'content-length': '5' },
    }), 4),
    (error) => error instanceof UrlPolicyError && error.code === 'MANIFEST_TOO_LARGE',
  );
  await assert.rejects(
    readManifestText(new Response('12345'), 4),
    (error) => error instanceof UrlPolicyError && error.code === 'MANIFEST_TOO_LARGE',
  );
  assert.equal(await readManifestText(new Response('#EXTM3U'), 16), '#EXTM3U');
});

test('readManifestText handles many tiny chunks within the byte cap', async () => {
  let remaining = 20_000;
  const body = new ReadableStream({
    pull(controller) {
      if (remaining === 0) {
        controller.close();
        return;
      }
      controller.enqueue(Uint8Array.of(0x61));
      remaining -= 1;
    },
  });
  const text = await readManifestText(new Response(body), 20_000);
  assert.equal(text.length, 20_000);
  assert.equal(text[0], 'a');
  assert.equal(text.at(-1), 'a');
});

test('resolveProxyTarget rejects duplicate/malformed and token-external u values', () => {
  const token = saveProxyEntry({
    url: 'https://media.example/master.m3u8',
    headers: {},
    mediaType: 'application/x-mpegURL',
  });
  const entry = getProxyEntry(token);

  assert.equal(resolveProxyTarget(entry, undefined).href, entry.url);
  assert.throws(() => resolveProxyTarget(entry, ['a', 'b']), UrlPolicyError);
  assert.throws(() => resolveProxyTarget(entry, '%%%'), UrlPolicyError);

  const sameOrigin = encodeProxyTarget('https://media.example/segment.ts');
  assert.equal(resolveProxyTarget(entry, sameOrigin).href, 'https://media.example/segment.ts');

  const forged = encodeProxyTarget('https://attacker.example/segment.ts');
  assert.throws(
    () => resolveProxyTarget(entry, forged),
    (error) => error instanceof UrlPolicyError && error.code === 'PROXY_TARGET_NOT_ALLOWED',
  );
});
