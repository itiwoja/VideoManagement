// lib/proxy-store.js
// 抽出した動画 URL とその upstream ヘッダ (Cookie / Referer 等) を一時保存するストア。
//
// 動画サイト (spankbang / pornhub 等) の直リンクは、ブラウザから直接 fetch すると
// Cookie / Referer 不足で 403 になることが多い。そこで:
//   1. /api/extract で yt-dlp が返した URL + headers を一時保存し、token を発行
//   2. クライアントには /api/stream/<token> を返す
//   3. /api/stream/<token> が upstream に正しいヘッダで fetch して stream
//
// メモリベース (in-memory)。プロセス再起動で消える。TTL 1 時間。

import crypto from 'node:crypto';

/**
 * @typedef {Object} ProxyEntry
 * @property {string} url            upstream の動画 URL
 * @property {Record<string, string>} headers  upstream へ送るヘッダ
 * @property {string} mediaType      'video/mp4' | 'application/x-mpegURL' | etc
 * @property {number} expiresAt      Unix ms
 */

const TTL_MS = 60 * 60 * 1000; // 1 時間
const MAX_ENTRIES = 1000;

/** @type {Map<string, ProxyEntry>} */
const store = new Map();

/**
 * upstream URL とヘッダを保存し、token を返す。
 * @param {{ url: string, headers: Record<string, string>, mediaType: string }} input
 * @returns {string} token (URL safe)
 */
export function saveProxyEntry({ url, headers, mediaType }) {
  // 古いエントリを掃除 (LRU 風)
  cleanupExpired();
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) store.delete(oldestKey);
  }

  const token = crypto.randomBytes(24).toString('base64url');
  store.set(token, {
    url,
    headers,
    mediaType,
    expiresAt: Date.now() + TTL_MS,
  });
  return token;
}

/**
 * @param {string} token
 * @returns {ProxyEntry | null}
 */
export function getProxyEntry(token) {
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(token);
    return null;
  }
  return entry;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.expiresAt < now) store.delete(k);
  }
}
