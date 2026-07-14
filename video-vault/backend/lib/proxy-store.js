// lib/proxy-store.js
// 抽出した動画 URL と upstream ヘッダを一時保存する、認可境界付きストア。

import crypto from 'node:crypto';
import {
  isCrossOriginHeaderAllowed,
  parseHttpUrl,
  UrlPolicyError,
} from './safe-fetch.js';

/**
 * @typedef {Object} ProxyEntry
 * @property {string} url canonical upstream root URL
 * @property {string} rootOrigin canonical origin for same-origin children
 * @property {Record<string, string>} headers upstream request headers
 * @property {string} mediaType
 * @property {number} expiresAt Unix ms
 * @property {Set<string>} manifestUrls exact canonical URLs learned from HLS
 * @property {number} manifestUrlBytes UTF-8 bytes retained by manifestUrls
 */

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
export const MAX_MANIFEST_URLS = 10_000;
export const MAX_MANIFEST_URL_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_MANIFEST_URL_BYTES = 64 * 1024 * 1024;

/** @type {Map<string, ProxyEntry>} */
const store = new Map();
let totalManifestUrlBytes = 0;

function deleteEntry(token) {
  const entry = store.get(token);
  if (!entry) return false;
  totalManifestUrlBytes = Math.max(0, totalManifestUrlBytes - entry.manifestUrlBytes);
  return store.delete(token);
}

/**
 * Save the upstream root capability and return a URL-safe token.
 * @param {{ url: string, headers: Record<string, string>, mediaType: string }} input
 */
export function saveProxyEntry({ url, headers, mediaType }) {
  const rootUrl = parseHttpUrl(url);
  cleanupExpired();
  if (store.size >= MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) deleteEntry(oldestKey);
  }

  const token = crypto.randomBytes(24).toString('base64url');
  store.set(token, {
    url: rootUrl.href,
    rootOrigin: rootUrl.origin,
    headers: { ...headers },
    mediaType,
    expiresAt: Date.now() + TTL_MS,
    manifestUrls: new Set(),
    manifestUrlBytes: 0,
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
    deleteEntry(token);
    return null;
  }
  return entry;
}

/**
 * Atomically add URLs discovered in one successfully parsed HLS manifest.
 * No URL is added if any candidate is invalid or the cap is exceeded.
 * @param {string} token
 * @param {Iterable<string | URL>} urls
 * @returns {boolean} false when the token is absent/expired
 */
export function registerProxyUrls(token, urls) {
  const entry = getProxyEntry(token);
  if (!entry) return false;

  const canonicalBatch = new Set();
  for (const rawUrl of urls) canonicalBatch.add(parseHttpUrl(rawUrl).href);

  let additions = 0;
  let additionBytes = 0;
  for (const url of canonicalBatch) {
    if (!entry.manifestUrls.has(url)) {
      additions += 1;
      additionBytes += Buffer.byteLength(url, 'utf8');
    }
  }
  if (entry.manifestUrls.size + additions > MAX_MANIFEST_URLS) {
    throw new UrlPolicyError('MANIFEST_URL_LIMIT', 'Manifest URL limit exceeded');
  }
  if (
    entry.manifestUrlBytes + additionBytes > MAX_MANIFEST_URL_BYTES ||
    totalManifestUrlBytes + additionBytes > MAX_TOTAL_MANIFEST_URL_BYTES
  ) {
    throw new UrlPolicyError('MANIFEST_URL_BYTES_LIMIT', 'Manifest URL limit exceeded');
  }

  for (const url of canonicalBatch) entry.manifestUrls.add(url);
  entry.manifestUrlBytes += additionBytes;
  totalManifestUrlBytes += additionBytes;
  return true;
}

/**
 * Issue #5 contract: the root origin is allowed; another origin requires an
 * exact path/query capability learned from a processed HLS manifest.
 * @param {ProxyEntry | null} entry
 * @param {string | URL} target
 */
export function isProxyTargetAllowed(entry, target) {
  if (!entry) return false;
  try {
    const url = parseHttpUrl(target);
    return url.origin === entry.rootOrigin || entry.manifestUrls.has(url.href);
  } catch {
    return false;
  }
}

/**
 * Root credentials never cross origin. Playback context such as User-Agent and
 * Referer remains available to explicitly manifest-authorized CDN resources.
 * @param {ProxyEntry} entry
 * @param {string | URL} target
 * @returns {Record<string, string>}
 */
export function getProxyHeaders(entry, target) {
  const targetUrl = parseHttpUrl(target);
  const headers = { ...entry.headers };
  if (targetUrl.origin === entry.rootOrigin) return headers;

  for (const name of Object.keys(headers)) {
    if (!isCrossOriginHeaderAllowed(name)) delete headers[name];
  }
  return headers;
}

function cleanupExpired() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt < now) deleteEntry(key);
  }
}
