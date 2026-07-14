import { resolveProxyTarget } from './hls-proxy.js';
import {
  getProxyHeaders,
  isProxyTargetAllowed,
} from './proxy-store.js';
import { safeFetch, UrlPolicyError } from './safe-fetch.js';

function deleteHeader(headers, expectedName) {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === expectedName) delete headers[name];
  }
}

function looksLikeHlsUrl(url) {
  return /\.m3u8$/i.test(url.pathname);
}

function looksLikeHlsMediaType(mediaType) {
  return typeof mediaType === 'string' && mediaType.toLowerCase().includes('mpegurl');
}

function isKnownHlsTarget(entry, target) {
  return looksLikeHlsUrl(target) || (
    target.href === entry.url && looksLikeHlsMediaType(entry.mediaType)
  );
}

export function isHlsResource(entry, requestedUrl, finalUrl, response) {
  const contentType = response.headers.get('content-type') || '';
  return isKnownHlsTarget(entry, requestedUrl) ||
    looksLikeHlsUrl(finalUrl) ||
    contentType.toLowerCase().includes('mpegurl');
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Best effort: this response will not be consumed after a safe refetch.
  }
}

/**
 * Resolve one stream request into an authorized, SSRF-filtered upstream fetch.
 * Keeping this orchestration outside Express makes "deny before transport" and
 * redirect authorization directly testable.
 *
 * @param {{
 *   entry: import('./proxy-store.js').ProxyEntry,
 *   queryValue?: unknown,
 *   range?: string,
 *   fetcher?: typeof safeFetch,
 * }} input
 */
export async function fetchProxyResource({
  entry,
  queryValue,
  range,
  fetcher = safeFetch,
}) {
  const target = resolveProxyTarget(entry, queryValue);
  const headers = getProxyHeaders(entry, target);
  deleteHeader(headers, 'range');
  if (range) headers.Range = String(range);

  const authorize = (url) => {
    if (!isProxyTargetAllowed(entry, url)) {
      throw new UrlPolicyError('PROXY_TARGET_NOT_ALLOWED', 'Proxy target not allowed');
    }
  };

  const result = await fetcher(
    target,
    { method: 'GET', headers },
    { authorize },
  );
  return { ...result, requestedUrl: target };
}

/**
 * Fetch a stream target while ensuring an HLS manifest is always a complete,
 * successful response. Known manifests never receive a client Range header;
 * an extensionless manifest discovered via Content-Type is safely refetched.
 *
 * @param {{
 *   entry: import('./proxy-store.js').ProxyEntry,
 *   queryValue?: unknown,
 *   range?: string,
 *   fetcher?: typeof safeFetch,
 * }} input
 */
export async function fetchStreamResource(input) {
  const requestedUrl = resolveProxyTarget(input.entry, input.queryValue);
  const initialRange = isKnownHlsTarget(input.entry, requestedUrl)
    ? undefined
    : input.range;

  let result = await fetchProxyResource({ ...input, range: initialRange });
  const isHls = isHlsResource(
    input.entry,
    result.requestedUrl,
    result.url,
    result.response,
  );

  if (isHls && result.response.status === 206) {
    await cancelResponseBody(result.response);
    result = await fetchProxyResource({ ...input, range: undefined });
  }

  if (isHls && result.response.status === 206) {
    await cancelResponseBody(result.response);
    throw new UrlPolicyError('PARTIAL_HLS_MANIFEST', 'Invalid HLS response');
  }
  if (isHls && !result.response.ok) {
    await cancelResponseBody(result.response);
    throw new UrlPolicyError('INVALID_HLS_RESPONSE', 'Invalid HLS response');
  }

  return { ...result, isHls };
}
