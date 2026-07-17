// test/videos.test.js
// node:test による結合テスト。
//
// #13: 実 data.db や手動起動中の dev server に依存せず、テストごとに
// DB_PATH=:memory: の使い捨てサーバープロセスを spawn して完全に分離する。
// これで `npm test` は他に何も起動していない CI 環境でもそのまま動く。

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server.js');

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'http://127.0.0.1:5173'; // #20 CSRF ガードの allowlist に含まれる既定 Origin

/** @type {import('node:child_process').ChildProcess} */
let child;

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // まだ起動していない
    }
    await sleep(100);
  }
  throw new Error(`server did not become healthy within ${timeoutMs}ms`);
}

before(async () => {
  child = spawn(process.execPath, ['--no-warnings', SERVER_PATH], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DB_PATH: ':memory:',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      JWT_SECRET: crypto.randomBytes(48).toString('base64'),
    },
    stdio: 'ignore',
  });
  await waitForHealth();
});

after(() => {
  child?.kill();
});

test('GET /api/health returns ok', async () => {
  const { status, json } = await fetchJson('/api/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.initialized, false); // インメモリ DB は毎回まっさら
});

test('GET /api/auth/me returns wrapped state', async () => {
  const { status, json } = await fetchJson('/api/auth/me');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.data.authenticated, false);
  assert.equal(json.data.initialized, false);
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

test('POST /api/auth/login before setup returns 409', async () => {
  const { status, json } = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ password: 'notrealpassword12345' }),
  });
  assert.equal(status, 409);
  assert.equal(json.ok, false);
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

// ---------------------------------------------------------------- authenticated flow
// 以降は 1 本のセッション Cookie を使い回して、setup → login → CRUD → trash まで通す。

let sessionCookie = '';

function withSession(init = {}) {
  return {
    ...init,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: sessionCookie, ...(init.headers ?? {}) },
  };
}

test('POST /api/auth/setup creates the password and returns a session cookie', async () => {
  const { status, json, headers } = await fetchJson('/api/auth/setup', withSession({
    method: 'POST',
    body: JSON.stringify({ password: 'correct horse battery staple' }),
  }));
  assert.equal(status, 200);
  assert.equal(json.data.initialized, true);
  const setCookie = headers.get('set-cookie');
  assert.ok(setCookie, 'expected a Set-Cookie header');
  sessionCookie = setCookie.split(';')[0];
});

test('authenticated GET /api/videos now succeeds and starts empty', async () => {
  const { status, json } = await fetchJson('/api/videos', withSession());
  assert.equal(status, 200);
  assert.deepEqual(json.videos, []);
});

let videoId;

test('POST /api/videos creates a video', async () => {
  const { status, json } = await fetchJson('/api/videos', withSession({
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.com/watch?v=abc', title: 'Test Video' }),
  }));
  assert.equal(status, 200);
  assert.equal(json.video.title, 'Test Video');
  assert.equal(json.created, true);
  videoId = json.video.id;
});

test('POST /api/videos with the same URL reports a duplicate', async () => {
  const { json } = await fetchJson('/api/videos', withSession({
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.com/watch?v=abc', title: 'Test Video' }),
  }));
  assert.equal(json.duplicate, true);
  assert.equal(json.video.id, videoId);
});

test('PATCH /api/videos/:id updates rating and note', async () => {
  const { status, json } = await fetchJson(`/api/videos/${videoId}`, withSession({
    method: 'PATCH',
    body: JSON.stringify({ rating: 5, note: 'great' }),
  }));
  assert.equal(status, 200);
  assert.equal(json.data.video.rating, 5);
  assert.equal(json.data.video.note, 'great');
});

test('POST /api/videos/:id/tags attaches a tag', async () => {
  const { status, json } = await fetchJson(`/api/videos/${videoId}/tags`, withSession({
    method: 'POST',
    body: JSON.stringify({ name: 'favorite' }),
  }));
  assert.equal(status, 200);
  assert.equal(json.data.tag.name, 'favorite');
});

// #12: FTS5 (trigram) 全文検索。3文字以上は FTS5、未満は LIKE フォールバック。
let jpVideoId;

test('setup: add a Japanese-titled video for search tests', async () => {
  const { json } = await fetchJson('/api/videos', withSession({
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.com/tokyo-night', title: '東京の夜景タイムラプス' }),
  }));
  jpVideoId = json.video.id;
  // POST /api/videos は note を受け付けないので (title/url のみ)、PATCH で後付けする。
  await fetchJson(`/api/videos/${jpVideoId}`, withSession({
    method: 'PATCH',
    body: JSON.stringify({ note: 'とても綺麗だった' }),
  }));
});

test('GET /api/videos?q= matches a >=3 char Japanese substring via FTS5', async () => {
  const { json } = await fetchJson('/api/videos?q=%E6%9D%B1%E4%BA%AC%E3%81%AE', withSession()); // "東京の"
  assert.equal(json.videos.length, 1);
  assert.equal(json.videos[0].id, jpVideoId);
});

test('GET /api/videos?q= with a <3 char query cannot match via FTS5 alone (trigram floor)', async () => {
  // "綺麗" is 2 chars. If this ever went through the FTS5 MATCH path it would find nothing
  // (trigram needs >=3 chars) — this test exists to document why the LIKE fallback below matters.
  const { json } = await fetchJson(`/api/videos?q=${encodeURIComponent('綺麗')}`, withSession());
  assert.equal(json.videos.length, 1); // passes because findAll() routes <3 char queries to LIKE, not FTS5
  assert.equal(json.videos[0].id, jpVideoId);
});

test('GET /api/videos?q= matches an attached tag name via FTS5', async () => {
  await fetchJson(`/api/videos/${jpVideoId}/tags`, withSession({
    method: 'POST',
    body: JSON.stringify({ name: 'travel' }),
  }));
  const { json } = await fetchJson('/api/videos?q=travel', withSession());
  assert.equal(json.videos.length, 1);
  assert.equal(json.videos[0].id, jpVideoId);
});

test('GET /api/videos?q= does not match unrelated videos', async () => {
  const { json } = await fetchJson('/api/videos?q=nonexistentquery', withSession());
  assert.equal(json.videos.length, 0);
});

test('cleanup: purge the Japanese-titled search test video', async () => {
  await fetchJson(`/api/videos/${jpVideoId}`, withSession({ method: 'DELETE' }));
  const purge = await fetchJson(`/api/videos/${jpVideoId}/purge`, withSession({ method: 'DELETE' }));
  assert.equal(purge.status, 200);
});

test('POST /api/videos/:id/suggest-tags returns [] when ANTHROPIC_API_KEY is unset (no crash, no 500)', async () => {
  // このテストプロセスには ANTHROPIC_API_KEY を渡していないので、tagSuggest.suggestTags()
  // は API 呼び出しをせずに即 [] を返すはず。保存/取得フローを壊さないことの確認。
  const { status, json } = await fetchJson(`/api/videos/${videoId}/suggest-tags`, withSession({
    method: 'POST',
  }));
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.deepEqual(json.data.tags, []);
});

test('POST /api/videos/:id/view records a view and history entry', async () => {
  const { status, json } = await fetchJson(`/api/videos/${videoId}/view`, withSession({ method: 'POST' }));
  assert.equal(status, 200);
  assert.equal(json.video.view_count, 1);

  const history = await fetchJson('/api/history', withSession());
  assert.equal(history.json.data.entries.length, 1);
  assert.equal(history.json.data.entries[0].video_id, videoId);
});

test('DELETE /api/videos/:id moves it to trash, not a hard delete', async () => {
  const del = await fetchJson(`/api/videos/${videoId}`, withSession({ method: 'DELETE' }));
  assert.equal(del.status, 200);

  const list = await fetchJson('/api/videos', withSession());
  assert.deepEqual(list.json.videos, []);

  const trash = await fetchJson('/api/videos/trash', withSession());
  assert.equal(trash.json.data.videos.length, 1);
  assert.equal(trash.json.data.videos[0].id, videoId);
});

test('POST /api/videos/:id/restore brings it back to the main list', async () => {
  const { status, json } = await fetchJson(`/api/videos/${videoId}/restore`, withSession({ method: 'POST' }));
  assert.equal(status, 200);
  assert.equal(json.data.video.deleted_at, null);

  const list = await fetchJson('/api/videos', withSession());
  assert.equal(list.json.videos.length, 1);
});

test('DELETE /api/videos/:id/purge permanently removes it', async () => {
  await fetchJson(`/api/videos/${videoId}`, withSession({ method: 'DELETE' })); // back to trash first
  const purge = await fetchJson(`/api/videos/${videoId}/purge`, withSession({ method: 'DELETE' }));
  assert.equal(purge.status, 200);

  const trash = await fetchJson('/api/videos/trash', withSession());
  assert.deepEqual(trash.json.data.videos, []);
});

test('PATCH /api/videos/:id on an unknown id returns 404', async () => {
  const { status } = await fetchJson('/api/videos/999999', withSession({
    method: 'PATCH',
    body: JSON.stringify({ rating: 3 }),
  }));
  assert.equal(status, 404);
});
