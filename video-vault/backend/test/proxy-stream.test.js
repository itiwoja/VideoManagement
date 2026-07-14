import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeProxyTarget } from '../lib/hls-proxy.js';
import {
  getProxyEntry,
  registerProxyUrls,
  saveProxyEntry,
} from '../lib/proxy-store.js';
import {
  fetchProxyResource,
  fetchStreamResource,
} from '../lib/proxy-stream.js';
import { UrlPolicyError } from '../lib/safe-fetch.js';

function makeEntry() {
  const token = saveProxyEntry({
    url: 'https://media.example/master.m3u8',
    headers: {
      Cookie: 'session=secret',
      Authorization: 'Bearer secret',
      Referer: 'https://page.example/watch',
    },
    mediaType: 'application/x-mpegURL',
  });
  return { token, entry: getProxyEntry(token) };
}

test('fetchProxyResource rejects a forged cross-origin u before transport', async () => {
  const { entry } = makeEntry();
  let fetchCalls = 0;
  await assert.rejects(
    fetchProxyResource({
      entry,
      queryValue: encodeProxyTarget('https://attacker.example/steal'),
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error('must not run');
      },
    }),
    (error) => error instanceof UrlPolicyError && error.code === 'PROXY_TARGET_NOT_ALLOWED',
  );
  assert.equal(fetchCalls, 0);
});

test('fetchProxyResource strips root secrets for an exact registered cross-origin target', async () => {
  const { token, entry } = makeEntry();
  const target = 'https://cdn.example/segment.ts?sig=abc';
  registerProxyUrls(token, [target]);

  let observed;
  const result = await fetchProxyResource({
    entry,
    queryValue: encodeProxyTarget(target),
    range: 'bytes=0-1023',
    fetcher: async (url, init, options) => {
      await options.authorize(url);
      observed = { url: url.href, headers: init.headers };
      return { response: new Response('video'), url };
    },
  });

  assert.equal(result.url.href, target);
  assert.equal(observed.url, target);
  assert.equal(observed.headers.Cookie, undefined);
  assert.equal(observed.headers.Authorization, undefined);
  assert.equal(observed.headers.Referer, 'https://page.example/watch');
  assert.equal(observed.headers.Range, 'bytes=0-1023');
});

test('fetchProxyResource authorization callback rejects an unlisted redirect hop', async () => {
  const { entry } = makeEntry();
  await assert.rejects(
    fetchProxyResource({
      entry,
      fetcher: async (_url, _init, options) => {
        await options.authorize(new URL('https://attacker.example/redirect'));
        throw new Error('unreachable');
      },
    }),
    (error) => error instanceof UrlPolicyError && error.code === 'PROXY_TARGET_NOT_ALLOWED',
  );
});

test('fetchProxyResource keeps root headers for same-origin targets', async () => {
  const { entry } = makeEntry();
  const target = 'https://media.example/alternate.ts';
  let headers;
  await fetchProxyResource({
    entry,
    queryValue: encodeProxyTarget(target),
    fetcher: async (url, init, options) => {
      await options.authorize(url);
      headers = init.headers;
      return { response: new Response('video'), url };
    },
  });
  assert.equal(headers.Cookie, 'session=secret');
  assert.equal(headers.Authorization, 'Bearer secret');
  assert.equal(headers.Range, undefined);
});

test('fetchStreamResource omits Range for known HLS and keeps requested-URL detection after redirect', async () => {
  const { entry } = makeEntry();
  let observedRange;
  const result = await fetchStreamResource({
    entry,
    range: 'bytes=100-200',
    fetcher: async (_url, init, options) => {
      const finalUrl = new URL('https://media.example/extensionless');
      await options.authorize(finalUrl);
      observedRange = init.headers.Range;
      return {
        response: new Response('#EXTM3U', {
          headers: { 'content-type': 'application/octet-stream' },
        }),
        url: finalUrl,
      };
    },
  });

  assert.equal(observedRange, undefined);
  assert.equal(result.requestedUrl.href, entry.url);
  assert.equal(result.url.href, 'https://media.example/extensionless');
  assert.equal(result.isHls, true);
});

test('fetchStreamResource refetches an unexpectedly partial HLS response without Range', async () => {
  const { token, entry } = makeEntry();
  const target = 'https://cdn.example/extensionless';
  registerProxyUrls(token, [target]);
  const ranges = [];

  const result = await fetchStreamResource({
    entry,
    queryValue: encodeProxyTarget(target),
    range: 'bytes=10-99',
    fetcher: async (url, init, options) => {
      await options.authorize(url);
      ranges.push(init.headers.Range);
      return {
        response: new Response('#EXTM3U\nsegment.ts', {
          status: ranges.length === 1 ? 206 : 200,
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        }),
        url,
      };
    },
  });

  assert.deepEqual(ranges, ['bytes=10-99', undefined]);
  assert.equal(result.response.status, 200);
  assert.equal(result.isHls, true);
});

test('fetchStreamResource rejects an HLS server that only returns partial responses', async () => {
  const { entry } = makeEntry();
  let calls = 0;
  await assert.rejects(
    fetchStreamResource({
      entry,
      range: 'bytes=10-99',
      fetcher: async (url, init, options) => {
        await options.authorize(url);
        calls += 1;
        assert.equal(init.headers.Range, undefined);
        return {
          response: new Response('#EXTM3U\nsegment.ts', {
            status: 206,
            headers: { 'content-type': 'application/vnd.apple.mpegurl' },
          }),
          url,
        };
      },
    }),
    (error) => error instanceof UrlPolicyError && error.code === 'PARTIAL_HLS_MANIFEST',
  );
  assert.equal(calls, 2);
});

test('fetchStreamResource keeps HLS detection sticky when a partial refetch changes MIME type', async () => {
  const { token, entry } = makeEntry();
  const target = 'https://cdn.example/extensionless';
  registerProxyUrls(token, [target]);
  let calls = 0;

  await assert.rejects(
    fetchStreamResource({
      entry,
      queryValue: encodeProxyTarget(target),
      range: 'bytes=10-99',
      fetcher: async (url, _init, options) => {
        await options.authorize(url);
        calls += 1;
        return {
          response: new Response('#EXTM3U\nsegment.ts', {
            status: 206,
            headers: {
              'content-type': calls === 1
                ? 'application/vnd.apple.mpegurl'
                : 'application/octet-stream',
            },
          }),
          url,
        };
      },
    }),
    (error) => error instanceof UrlPolicyError && error.code === 'PARTIAL_HLS_MANIFEST',
  );
  assert.equal(calls, 2);
});
