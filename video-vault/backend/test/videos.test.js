// test/videos.test.js
// Node 22 内蔵 node:test で実行する最小限のスモークテスト。
//
// Run: npm test
//
// Phase 3 で認証層が入ったので、/api/videos などは 401 を返すようになった。
// in-memory DB と空きポートで実サーバーを起動し、auth と URL-policy 境界を確認する。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { encodeProxyTarget } from '../lib/hls-proxy.js';
import { saveProxyEntry } from '../lib/proxy-store.js';

let BASE;
let server;
let db;
let authCookie;

async function fetchJson(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  process.env.JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';
  process.env.VIDEO_VAULT_DB_PATH = ':memory:';
  const serverModule = await import(`../server.js?integration=${Date.now()}`);
  db = serverModule.db;
  server = serverModule.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  BASE = `http://127.0.0.1:${address.port}`;

  const setup = await fetchJson('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'integration-test-password' }),
  });
  assert.equal(setup.status, 200);
  const setCookie = setup.headers.get('set-cookie');
  assert.ok(setCookie);
  authCookie = setCookie.split(';', 1)[0];
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db?.close();
  delete process.env.VIDEO_VAULT_DB_PATH;
});

test('GET /api/health returns ok', async () => {
  const { status, json } = await fetchJson('/api/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  // initialized は boolean
  assert.equal(typeof json.initialized, 'boolean');
});

test('GET /api/auth/me returns wrapped state', async () => {
  const { status, json } = await fetchJson('/api/auth/me');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(typeof json.data.authenticated, 'boolean');
  assert.equal(typeof json.data.initialized, 'boolean');
});

test('GET /api/videos requires auth (401 when no cookie/token)', async () => {
  const { status, json } = await fetchJson('/api/videos');
  assert.equal(status, 401);
  assert.equal(json.ok, false);
  assert.equal(json.error, 'unauthorized');
});

test('GET /api/tags requires auth (401)', async () => {
  const { status } = await fetchJson('/api/tags');
  assert.equal(status, 401);
});

test('GET /api/history requires auth (401)', async () => {
  const { status } = await fetchJson('/api/history');
  assert.equal(status, 401);
});

test('POST /api/auth/login with empty body returns 401', async () => {
  const { status, json } = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  // 未セットアップなら 409、セットアップ済みなら 401
  assert.ok(status === 401 || status === 409, `unexpected status ${status}`);
  assert.equal(json.ok, false);
});

test('POST /api/auth/login with bogus password returns 401 or 409', async () => {
  const { status } = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'notrealpassword12345' }),
  });
  assert.ok(status === 401 || status === 409, `unexpected status ${status}`);
});

test('POST /api/extract rejects a non-HTTP URL as malformed input', async () => {
  const { status, json } = await fetchJson('/api/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: authCookie,
    },
    body: JSON.stringify({ url: 'file:///etc/passwd' }),
  });
  assert.equal(status, 400);
  assert.equal(json.error, 'invalid url');
});

test('POST /api/extract rejects a private HTTP destination with 403', async () => {
  const { status, json } = await fetchJson('/api/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: authCookie,
    },
    body: JSON.stringify({ url: 'http://127.0.0.1/admin' }),
  });
  assert.equal(status, 403);
  assert.equal(json.error, 'url not allowed');
});

test('GET /api/stream denies a forged cross-origin sub-resource before fetch', async () => {
  const token = saveProxyEntry({
    url: 'https://93.184.216.34/master.m3u8',
    headers: { Cookie: 'must-not-leak' },
    mediaType: 'application/x-mpegURL',
  });
  const forged = encodeProxyTarget('https://attacker.example/steal');
  const { status, json } = await fetchJson(`/api/stream/${token}?u=${forged}`, {
    headers: { Cookie: authCookie },
  });
  assert.equal(status, 403);
  assert.equal(json.error, 'sub-resource url not allowed');
});

test('GET /api/stream rejects malformed sub-resource encoding with 400', async () => {
  const token = saveProxyEntry({
    url: 'https://93.184.216.34/master.m3u8',
    headers: {},
    mediaType: 'application/x-mpegURL',
  });
  const { status, json } = await fetchJson(`/api/stream/${token}?u=%25%25%25`, {
    headers: { Cookie: authCookie },
  });
  assert.equal(status, 400);
  assert.equal(json.error, 'invalid sub-resource url');
});

test('GET /api/stream rejects a percent-encoded alias of a canonical sub-resource', async () => {
  const token = saveProxyEntry({
    url: 'https://93.184.216.34/master.m3u8',
    headers: {},
    mediaType: 'application/x-mpegURL',
  });
  const canonical = encodeProxyTarget('https://attacker.example/steal');
  const firstByteAlias = `%${canonical.charCodeAt(0).toString(16)}`;
  const { status, json } = await fetchJson(
    `/api/stream/${token}?u=${firstByteAlias}${canonical.slice(1)}`,
    { headers: { Cookie: authCookie } },
  );
  assert.equal(status, 400);
  assert.equal(json.error, 'invalid sub-resource url');
});

test('GET /api/stream rejects a structured non-string sub-resource query', async () => {
  const token = saveProxyEntry({
    url: 'https://93.184.216.34/master.m3u8',
    headers: {},
    mediaType: 'application/x-mpegURL',
  });
  const canonical = encodeProxyTarget('https://attacker.example/steal');
  const { status, json } = await fetchJson(
    `/api/stream/${token}?u[]=${canonical}`,
    { headers: { Cookie: authCookie } },
  );
  assert.equal(status, 400);
  assert.equal(json.error, 'invalid sub-resource url');
});
