// test/videos.test.js
// Node 22 内蔵 node:test で実行する最小限のスモークテスト。
// Run: node --no-warnings --test test/videos.test.js
//
// 一時 DB を使うのではなく実 DB に書き込むので、CI では別途用意すること。
// 今は手元で起動確認する目的のみ。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = 'http://127.0.0.1:3001';

let serverProcess;

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
  // server.js が別プロセスで起動している前提。CI ならここで spawn する。
  // 単発スモーク: 起動済みサーバーに繋ぐだけ。
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
});

test('GET /api/videos returns array', async () => {
  const { status, json } = await fetchJson('/api/videos');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.videos));
});

test('GET /api/tags returns wrapped data', async () => {
  const { status, json } = await fetchJson('/api/tags');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok(Array.isArray(json.data.tags));
});

test('GET /api/history returns wrapped data', async () => {
  const { status, json } = await fetchJson('/api/history?limit=5');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok(Array.isArray(json.data.entries));
});

test('PATCH non-existent video returns 404', async () => {
  const { status, json } = await fetchJson('/api/videos/9999999', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 5 }),
  });
  assert.equal(status, 404);
  assert.equal(json.ok, false);
});

test('PATCH with invalid rating returns 400', async () => {
  const { status, json } = await fetchJson('/api/videos/1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: 99 }),
  });
  assert.equal(status, 400);
  assert.equal(json.ok, false);
});
