// test/videos.test.js
// Node 22 内蔵 node:test で実行する最小限のスモークテスト。
//
// Run: npm test
//
// Phase 3 で認証層が入ったので、/api/videos などは 401 を返すようになった。
// このスモークは「サーバー稼働 + auth エンドポイント疎通」のみを見る。
// 詳しい認証フローの結合テストは別途 (Playwright 等) で書く想定。

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:3001';

async function fetchJson(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

before(async () => {
  const res = await fetchJson('/api/health').catch(() => ({ status: 0 }));
  if (res.status !== 200) {
    console.warn('[skip] server is not running on 3001 — skipping integration tests');
    process.exit(0);
  }
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

// #20 の CSRF ガードは状態変更系リクエストに allowlist 済み Origin を要求する。
// フロントエンド (ブラウザ) は常に Origin を送るので、テストでも同様に付与する。
const FRONTEND_ORIGIN = 'http://127.0.0.1:5173';

test('POST /api/auth/login with empty body returns 401', async () => {
  const { status, json } = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: FRONTEND_ORIGIN },
    body: JSON.stringify({}),
  });
  // 未セットアップなら 409、セットアップ済みなら 401
  assert.ok(status === 401 || status === 409, `unexpected status ${status}`);
  assert.equal(json.ok, false);
});

test('POST /api/auth/login with bogus password returns 401 or 409', async () => {
  const { status } = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: FRONTEND_ORIGIN },
    body: JSON.stringify({ password: 'notrealpassword12345' }),
  });
  assert.ok(status === 401 || status === 409, `unexpected status ${status}`);
});

test('POST /api/auth/login without Origin/Referer is rejected (CSRF guard)', async () => {
  const { status, json } = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'notrealpassword12345' }),
  });
  assert.equal(status, 403);
  assert.equal(json.ok, false);
});

test('POST /api/auth/login from a disallowed Origin is rejected (CSRF guard)', async () => {
  const { status, json } = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ password: 'notrealpassword12345' }),
  });
  assert.equal(status, 403);
  assert.equal(json.ok, false);
});
