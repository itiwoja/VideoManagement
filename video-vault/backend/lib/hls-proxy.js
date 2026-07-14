import { TextDecoder } from 'node:util';

import { isProxyTargetAllowed, MAX_MANIFEST_URLS } from './proxy-store.js';
import {
  MAX_URL_LENGTH,
  parseHttpUrl,
  UrlPolicyError,
} from './safe-fetch.js';

export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_REWRITTEN_MANIFEST_BYTES = 4 * 1024 * 1024;
export const MAX_MANIFEST_REFERENCES = 10_000;
const MAX_ENCODED_TARGET_LENGTH = Math.ceil(MAX_URL_LENGTH * 4 / 3) + 4;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

/** @param {string | URL} input */
export function encodeProxyTarget(input) {
  const url = parseHttpUrl(input);
  return Buffer.from(url.href, 'utf8').toString('base64url');
}

/**
 * Buffer's base64url decoder is intentionally permissive. Require a canonical
 * unpadded spelling and fatal UTF-8 decoding before treating the result as a
 * capability URL.
 * @param {string} encoded
 * @returns {URL}
 */
export function decodeProxyTarget(encoded) {
  if (
    typeof encoded !== 'string' ||
    encoded.length === 0 ||
    encoded.length > MAX_ENCODED_TARGET_LENGTH ||
    !BASE64URL_RE.test(encoded) ||
    encoded.length % 4 === 1
  ) {
    throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
  }

  let bytes;
  try {
    bytes = Buffer.from(encoded, 'base64url');
  } catch {
    throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
  }
  if (bytes.toString('base64url') !== encoded) {
    throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
  }

  let decoded;
  try {
    decoded = utf8Decoder.decode(bytes);
  } catch {
    throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
  }
  if (decoded.length > MAX_URL_LENGTH) {
    throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
  }
  return parseHttpUrl(decoded);
}

/**
 * Read the `u` query component from the raw request target. Express exposes an
 * already-decoded `req.query`, which would make percent-encoded aliases look
 * canonical before capability validation. Only one literal, unescaped `u`
 * component with a base64url value is accepted.
 * @param {string} originalUrl
 * @param {unknown} parsedQueryValue
 * @returns {string | undefined}
 */
export function getRawProxyTargetQuery(originalUrl, parsedQueryValue) {
  if (typeof originalUrl !== 'string') {
    throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
  }

  const queryStart = originalUrl.indexOf('?');
  if (queryStart === -1) return undefined;

  let value;
  for (const component of originalUrl.slice(queryStart + 1).split('&')) {
    if (!component) continue;
    const equals = component.indexOf('=');
    const rawName = equals === -1 ? component : component.slice(0, equals);

    if (rawName !== 'u') {
      try {
        const decodedName = decodeURIComponent(rawName.replace(/\+/g, ' '));
        if (decodedName === 'u' || decodedName.startsWith('u[')) {
          throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
        }
      } catch (error) {
        if (error instanceof UrlPolicyError) throw error;
      }
      continue;
    }

    if (value !== undefined) {
      throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
    }
    value = equals === -1 ? '' : component.slice(equals + 1);
  }

  if (value === undefined) {
    if (parsedQueryValue !== undefined) {
      throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
    }
    return undefined;
  }
  if (
    typeof parsedQueryValue !== 'string' ||
    parsedQueryValue !== value ||
    !BASE64URL_RE.test(value)
  ) {
    throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
  }
  return value;
}

/**
 * Convert the optional Express `u` query value into an authorized target. An
 * array (duplicate query parameter) is invalid rather than silently falling
 * back to the root URL.
 * @param {import('./proxy-store.js').ProxyEntry | null} entry
 * @param {unknown} queryValue
 * @returns {URL}
 */
export function resolveProxyTarget(entry, queryValue) {
  if (!entry) throw new UrlPolicyError('PROXY_TARGET_NOT_ALLOWED', 'Proxy target not allowed');
  if (queryValue === undefined) return parseHttpUrl(entry.url);
  if (typeof queryValue !== 'string') {
    throw new UrlPolicyError('INVALID_PROXY_TARGET', 'Invalid proxy target');
  }

  const target = decodeProxyTarget(queryValue);
  if (!isProxyTargetAllowed(entry, target)) {
    throw new UrlPolicyError('PROXY_TARGET_NOT_ALLOWED', 'Proxy target not allowed');
  }
  return target;
}

/**
 * Parse and rewrite a complete manifest without mutating token state. The
 * caller registers `urls` only after this function succeeds, making grants
 * transactional.
 * @param {string} text
 * @param {string | URL} baseUrl final fetched manifest URL
 * @param {string} parentToken
 * @returns {{ text: string, urls: string[] }}
 */
export function prepareHlsManifest(text, baseUrl, parentToken) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new UrlPolicyError('MANIFEST_TOO_LARGE', 'Invalid HLS manifest');
  }
  if (!/^#EXTM3U(?:\r?\n|$)/.test(text.replace(/^\uFEFF/, ''))) {
    throw new UrlPolicyError('INVALID_HLS_MANIFEST', 'Invalid HLS manifest');
  }
  if (typeof parentToken !== 'string' || !TOKEN_RE.test(parentToken)) {
    throw new UrlPolicyError('INVALID_PROXY_TOKEN', 'Invalid proxy token');
  }

  const canonicalBase = parseHttpUrl(baseUrl);
  const discovered = new Set();
  let referenceCount = 0;

  /** @param {string} rawTarget */
  const toProxy = (rawTarget) => {
    referenceCount += 1;
    if (referenceCount > MAX_MANIFEST_REFERENCES) {
      throw new UrlPolicyError('MANIFEST_REFERENCE_LIMIT', 'Invalid HLS manifest');
    }

    let target;
    try {
      target = parseHttpUrl(new URL(rawTarget, canonicalBase));
    } catch (error) {
      if (error instanceof UrlPolicyError) throw error;
      throw new UrlPolicyError('INVALID_MANIFEST_URL', 'Invalid HLS manifest');
    }

    discovered.add(target.href);
    if (discovered.size > MAX_MANIFEST_URLS) {
      throw new UrlPolicyError('MANIFEST_URL_LIMIT', 'Manifest URL limit exceeded');
    }
    return `/api/stream/${parentToken}?u=${encodeProxyTarget(target)}`;
  };

  const output = [];
  let outputBytes = 0;
  const reserveOutput = (part) => {
    outputBytes += Buffer.byteLength(part, 'utf8');
    if (outputBytes > MAX_REWRITTEN_MANIFEST_BYTES) {
      throw new UrlPolicyError('MANIFEST_OUTPUT_TOO_LARGE', 'Invalid HLS manifest');
    }
  };
  const beginOutputLine = () => {
    if (output.length > 0) reserveOutput('\n');
  };
  const pushOutput = (line) => {
    beginOutputLine();
    reserveOutput(line);
    output.push(line);
  };
  const pushRewrittenTagLine = (rawLine) => {
    beginOutputLine();
    const parts = [];
    const uriPattern = /URI="([^"]+)"/g;
    let lastIndex = 0;
    let match;
    while ((match = uriPattern.exec(rawLine)) !== null) {
      const prefix = rawLine.slice(lastIndex, match.index);
      const replacement = `URI="${toProxy(match[1])}"`;
      reserveOutput(prefix);
      reserveOutput(replacement);
      parts.push(prefix, replacement);
      lastIndex = uriPattern.lastIndex;
    }
    const suffix = rawLine.slice(lastIndex);
    reserveOutput(suffix);
    parts.push(suffix);
    output.push(parts.join(''));
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      pushOutput(rawLine);
      continue;
    }
    if (trimmed.startsWith('#')) {
      pushRewrittenTagLine(rawLine);
      continue;
    }
    pushOutput(toProxy(trimmed));
  }

  return { text: output.join('\n'), urls: [...discovered] };
}

/**
 * Read an HLS response with a hard byte cap even when Content-Length is absent
 * or dishonest.
 * @param {Response} response
 * @param {number} [limit]
 */
export async function readManifestText(response, limit = MAX_MANIFEST_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw new UrlPolicyError('MANIFEST_TOO_LARGE', 'Invalid HLS manifest');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const buffer = Buffer.allocUnsafe(limit);
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        throw new UrlPolicyError('MANIFEST_TOO_LARGE', 'Invalid HLS manifest');
      }
      Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        .copy(buffer, total - value.byteLength);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return utf8Decoder.decode(buffer.subarray(0, total));
}
