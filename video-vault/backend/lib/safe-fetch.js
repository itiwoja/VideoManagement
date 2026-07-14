import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

export const MAX_URL_LENGTH = 8192;
export const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'cache-control',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'origin',
  'pragma',
  'range',
  'referer',
  'user-agent',
]);

const blockedAddresses = new BlockList();
const ipv4MappedAddresses = new BlockList();
const allocatedGlobalIpv6Addresses = new BlockList();

ipv4MappedAddresses.addSubnet('::ffff:0:0', 96, 'ipv6');

// Fail closed for IANA-reserved gaps inside 2000::/3. This is the current
// aggregate allocation set, not merely the much wider assignable category.
// Source: https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.xhtml
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:200::', 23],
  ['2001:400::', 23],
  ['2001:600::', 23],
  ['2001:800::', 22],
  ['2001:c00::', 23],
  ['2001:e00::', 23],
  ['2001:1200::', 23],
  ['2001:1400::', 22],
  ['2001:1800::', 23],
  ['2001:1a00::', 23],
  ['2001:1c00::', 22],
  ['2001:2000::', 19],
  ['2001:4000::', 23],
  ['2001:4200::', 23],
  ['2001:4400::', 23],
  ['2001:4600::', 23],
  ['2001:4800::', 23],
  ['2001:4a00::', 23],
  ['2001:4c00::', 23],
  ['2001:5000::', 20],
  ['2001:8000::', 19],
  ['2001:a000::', 20],
  ['2001:b000::', 20],
  ['2002::', 16],
  ['2003::', 18],
  ['2400::', 12],
  ['2410::', 12],
  ['2600::', 12],
  ['2610::', 23],
  ['2620::', 23],
  ['2630::', 12],
  ['2800::', 12],
  ['2a00::', 12],
  ['2a10::', 12],
  ['2c00::', 12],
]) {
  allocatedGlobalIpv6Addresses.addSubnet(network, prefix, 'ipv6');
}

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

export class UrlPolicyError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   */
  constructor(code, message = 'URL is not allowed') {
    super(message);
    this.name = 'UrlPolicyError';
    this.code = code;
  }
}

/**
 * Undici wraps connector failures in a TypeError. Walk the cause chain so API
 * handlers can map policy failures without exposing the rejected URL/address.
 * @param {unknown} error
 */
export function getUrlPolicyError(error) {
  const seen = new Set();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (current instanceof UrlPolicyError) return current;
    seen.add(current);
    current = current.cause;
  }
  return null;
}

/** @param {unknown} error */
export function isUrlPolicyError(error) {
  return getUrlPolicyError(error) !== null;
}

/** @param {string} hostname */
function unbracketHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Node's BlockList supports IPv4-mapped IPv6 checks against IPv4 rules. Do not
 * add the whole ::ffff:0:0/96 range: doing so also makes public IPv4 checks
 * match that blanket rule.
 * Source: https://nodejs.org/docs/latest-v22.x/api/net.html#class-netblocklist
 * @param {string} address
 * @param {number} [family]
 */
export function isBlockedIp(address, family = isIP(address)) {
  const normalizedFamily = family === 'IPv4' ? 4 : family === 'IPv6' ? 6 : family;
  if (normalizedFamily !== 4 && normalizedFamily !== 6) return true;
  if (normalizedFamily === 6) {
    // Public IPv4-mapped literals remain subject to the IPv4 denylist. Every
    // other IPv6 destination must be in an allocated IANA global-unicast
    // aggregate; special-purpose holes remain covered by blockedAddresses.
    if (ipv4MappedAddresses.check(address, 'ipv6')) {
      return blockedAddresses.check(address, 'ipv6');
    }
    if (!allocatedGlobalIpv6Addresses.check(address, 'ipv6')) return true;
  }
  return blockedAddresses.check(address, normalizedFamily === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Parse and canonicalize before policy checks. WHATWG URL parsing normalizes
 * legacy integer/hex/octal IPv4 spellings, preventing raw-string bypasses.
 * @param {string | URL} input
 * @returns {URL}
 */
export function parseHttpUrl(input) {
  if (typeof input === 'string' && input.length > MAX_URL_LENGTH) {
    throw new UrlPolicyError('INVALID_URL', 'Invalid URL');
  }

  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new UrlPolicyError('INVALID_URL', 'Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlPolicyError('INVALID_URL', 'Invalid URL');
  }
  if (url.username || url.password || url.href.length > MAX_URL_LENGTH) {
    throw new UrlPolicyError('INVALID_URL', 'Invalid URL');
  }

  url.hash = '';
  const hostname = unbracketHostname(url.hostname);
  const literalFamily = isIP(hostname);
  if (literalFamily && isBlockedIp(hostname, literalFamily)) {
    throw new UrlPolicyError('BLOCKED_ADDRESS');
  }
  return url;
}

/**
 * Resolve every A/AAAA result. A hostname is rejected if even one answer is
 * non-global, so resolver ordering cannot hide a private address.
 * Source: https://nodejs.org/docs/latest-v22.x/api/dns.html#dnspromiseslookuphostname-options
 * @param {string} hostname
 * @param {{ lookup?: typeof dnsLookup }} [options]
 * @returns {Promise<Array<{address: string, family: number}>>}
 */
export async function resolvePublicAddresses(hostname, { lookup = dnsLookup } = {}) {
  const normalizedHostname = unbracketHostname(hostname);
  const literalFamily = isIP(normalizedHostname);
  if (literalFamily) {
    if (isBlockedIp(normalizedHostname, literalFamily)) {
      throw new UrlPolicyError('BLOCKED_ADDRESS');
    }
    return [{ address: normalizedHostname, family: literalFamily }];
  }

  let records;
  try {
    // `all: true` is required to reject a hostname if any answer is unsafe.
    records = await lookup(normalizedHostname, {
      all: true,
      family: 0,
      order: 'verbatim',
    });
  } catch (error) {
    if (isUrlPolicyError(error)) throw error;
    throw new UrlPolicyError('DNS_RESOLUTION_FAILED', 'URL could not be resolved');
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new UrlPolicyError('DNS_RESOLUTION_FAILED', 'URL could not be resolved');
  }

  const normalizedRecords = records.map((record) => ({
    address: String(record.address),
    family: record.family === 'IPv4' ? 4 : record.family === 'IPv6' ? 6 : Number(record.family),
  }));
  if (normalizedRecords.some(({ address, family }) => isBlockedIp(address, family))) {
    throw new UrlPolicyError('BLOCKED_ADDRESS');
  }
  return normalizedRecords;
}

/**
 * Validate an initial URL before handing it to a non-Undici boundary such as
 * yt-dlp. Native fetches use the connector lookup below to avoid re-resolution.
 * @param {string | URL} input
 * @param {{ lookup?: typeof dnsLookup }} [options]
 */
export async function assertPublicHttpUrl(input, options = {}) {
  const url = parseHttpUrl(input);
  const hostname = unbracketHostname(url.hostname);
  if (!isIP(hostname)) {
    await resolvePublicAddresses(hostname, options);
  }
  return url;
}

/**
 * Create a Node-compatible lookup callback for Undici's socket connector. The
 * connector receives the same complete answer set that passed policy, closing
 * the validate-then-re-resolve gap for native HTTP requests.
 * Undici Agent: https://github.com/nodejs/undici/blob/v7.28.0/docs/docs/api/Agent.md
 * Connector options: https://github.com/nodejs/undici/blob/v7.28.0/docs/docs/api/Client.md#parameter-clientoptions
 * @param {{ lookup?: typeof dnsLookup }} [dependencies]
 */
export function createSafeLookup({ lookup = dnsLookup } = {}) {
  return function safeLookup(hostname, options, callback) {
    resolvePublicAddresses(hostname, { lookup }).then(
      (records) => {
        const requestedFamily = Number(options?.family) || 0;
        const matching = requestedFamily
          ? records.filter((record) => record.family === requestedFamily)
          : records;

        if (matching.length === 0) {
          callback(new UrlPolicyError('DNS_RESOLUTION_FAILED', 'URL could not be resolved'));
          return;
        }
        if (options?.all) {
          callback(null, matching);
          return;
        }
        callback(null, matching[0].address, matching[0].family);
      },
      (error) => callback(error),
    );
  };
}

/** @param {{ lookup?: typeof dnsLookup }} [dependencies] */
export function createSafeAgent({ lookup = dnsLookup } = {}) {
  return new Agent({
    autoSelectFamily: true,
    connect: {
      lookup: createSafeLookup({ lookup }),
    },
  });
}

const defaultDispatcher = createSafeAgent();

/** @param {Response} response */
async function discardResponseBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The redirect response is already unusable; cancellation is best effort.
  }
}

/** @param {Headers} headers */
function stripSensitiveHeaders(headers) {
  for (const name of [...headers.keys()]) {
    if (!CROSS_ORIGIN_HEADER_ALLOWLIST.has(name.toLowerCase())) headers.delete(name);
  }
}

/** @param {string} name */
export function isCrossOriginHeaderAllowed(name) {
  return CROSS_ORIGIN_HEADER_ALLOWLIST.has(name.toLowerCase());
}

/**
 * Fetch a public HTTP(S) URL with manual, policy-checked redirects.
 * Request.redirect modes: https://developer.mozilla.org/en-US/docs/Web/API/Request/redirect
 *
 * @param {string | URL} input
 * @param {RequestInit & { dispatcher?: import('undici').Dispatcher }} [init]
 * @param {{
 *   authorize?: (url: URL) => void | Promise<void>,
 *   dispatcher?: import('undici').Dispatcher | null,
 *   fetchImpl?: typeof undiciFetch,
 *   maxRedirects?: number,
 * }} [options]
 * @returns {Promise<{ response: Response, url: URL }>}
 */
export async function safeFetch(input, init = {}, options = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    throw new UrlPolicyError('UNSUPPORTED_METHOD', 'Unsupported request method');
  }

  const fetchImpl = options.fetchImpl || undiciFetch;
  const dispatcher = options.dispatcher === undefined
    ? defaultDispatcher
    : options.dispatcher;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const headers = new Headers(init.headers || undefined);
  let currentUrl = parseHttpUrl(input);
  let redirects = 0;

  while (true) {
    if (options.authorize) await options.authorize(currentUrl);

    const requestInit = {
      ...init,
      method,
      headers,
      redirect: 'manual',
    };
    if (dispatcher) requestInit.dispatcher = dispatcher;

    const response = await fetchImpl(currentUrl, requestInit);
    const location = REDIRECT_STATUSES.has(response.status)
      ? response.headers.get('location')
      : null;
    if (!location) return { response, url: currentUrl };

    if (redirects >= maxRedirects) {
      await discardResponseBody(response);
      throw new UrlPolicyError('REDIRECT_LIMIT', 'Too many redirects');
    }

    let nextUrl;
    try {
      nextUrl = parseHttpUrl(new URL(location, currentUrl));
    } finally {
      await discardResponseBody(response);
    }

    if (nextUrl.origin !== currentUrl.origin) stripSensitiveHeaders(headers);
    currentUrl = nextUrl;
    redirects += 1;
  }
}
