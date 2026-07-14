import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REDIRECTS,
  UrlPolicyError,
  assertPublicHttpUrl,
  createSafeLookup,
  isBlockedIp,
  parseHttpUrl,
  resolvePublicAddresses,
  safeFetch,
} from '../lib/safe-fetch.js';

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:4700:4700::1111';

function lookupReturning(records) {
  return async (_hostname, options) => {
    assert.equal(options.all, true);
    return records;
  };
}

function response(status, location) {
  return new Response(null, {
    status,
    headers: location ? { location } : undefined,
  });
}

test('parseHttpUrl canonicalizes HTTP URLs and drops fragments', () => {
  const parsed = parseHttpUrl('HTTPS://Example.COM:443/a/../video?q=1#secret');
  assert.equal(parsed.href, 'https://example.com/video?q=1');
});

test('parseHttpUrl rejects non-HTTP schemes, credentials, malformed and oversized URLs', () => {
  for (const raw of [
    'file:///etc/passwd',
    'data:text/plain,hello',
    'ftp://example.com/video',
    'gopher://example.com/',
    'https://user:pass@example.com/video',
    'not a url',
    `https://example.com/${'x'.repeat(8192)}`,
  ]) {
    assert.throws(() => parseHttpUrl(raw), UrlPolicyError, raw);
  }
});

test('alternate IPv4 spellings are canonicalized and blocked before transport', () => {
  for (const raw of [
    'http://127.0.0.1/',
    'http://127.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://0/',
  ]) {
    assert.throws(() => parseHttpUrl(raw), UrlPolicyError, raw);
  }
});

test('isBlockedIp rejects private and special IPv4 while allowing public IPv4', () => {
  for (const address of [
    '0.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
  ]) {
    assert.equal(isBlockedIp(address), true, address);
  }
  assert.equal(isBlockedIp('8.8.8.8'), false);
  assert.equal(isBlockedIp(PUBLIC_V4), false);
});

test('isBlockedIp rejects private, special, and reserved IPv6', () => {
  for (const address of [
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::808:808',
    '64:ff9b:1::1',
    '100::1',
    '100:0:0:1::1',
    '2001::1',
    '2001:2::1',
    '2001:10::1',
    '2001:20::1',
    '2001:100::1',
    '2000::1',
    '2001:1000::1',
    '2001:db8::1',
    '2002::1',
    '2d00::1',
    '3000::1',
    '3fff::1',
    '3ffe::1',
    '4000::1',
    '5f00::1',
    '8000::1',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'fec0::1',
    'ff00::1',
  ]) {
    assert.equal(isBlockedIp(address), true, address);
  }
  assert.equal(isBlockedIp('::ffff:8.8.8.8'), false);
  assert.equal(isBlockedIp(PUBLIC_V6), false);
});

test('resolvePublicAddresses accepts all-public answers and preserves the inspected set', async () => {
  const records = [
    { address: PUBLIC_V4, family: 4 },
    { address: PUBLIC_V6, family: 6 },
  ];
  const resolved = await resolvePublicAddresses('example.com', {
    lookup: lookupReturning(records),
  });
  assert.deepEqual(resolved, records);
});

test('resolvePublicAddresses rejects mixed public/private answers and empty answers', async () => {
  await assert.rejects(
    resolvePublicAddresses('mixed.example', {
      lookup: lookupReturning([
        { address: PUBLIC_V4, family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    }),
    UrlPolicyError,
  );
  await assert.rejects(
    resolvePublicAddresses('empty.example', { lookup: lookupReturning([]) }),
    UrlPolicyError,
  );
});

test('resolvePublicAddresses fails closed on DNS errors', async () => {
  await assert.rejects(
    resolvePublicAddresses('missing.example', {
      lookup: async () => {
        const error = new Error('not found');
        error.code = 'ENOTFOUND';
        throw error;
      },
    }),
    UrlPolicyError,
  );
});

test('assertPublicHttpUrl checks every DNS answer and handles public literals without DNS', async () => {
  let calls = 0;
  const publicUrl = await assertPublicHttpUrl('https://example.com/video', {
    lookup: async () => {
      calls += 1;
      return [{ address: PUBLIC_V4, family: 4 }];
    },
  });
  assert.equal(publicUrl.href, 'https://example.com/video');
  assert.equal(calls, 1);

  const literal = await assertPublicHttpUrl('https://8.8.8.8/video', {
    lookup: async () => {
      throw new Error('literal must not resolve');
    },
  });
  assert.equal(literal.hostname, '8.8.8.8');
});

test('createSafeLookup supplies only the inspected public answer set to the connector', async () => {
  const records = [
    { address: PUBLIC_V6, family: 6 },
    { address: PUBLIC_V4, family: 4 },
  ];
  const safeLookup = createSafeLookup({ lookup: lookupReturning(records) });

  const all = await new Promise((resolve, reject) => {
    safeLookup('example.com', { all: true, family: 0 }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
  assert.deepEqual(all, records);

  const ipv4 = await new Promise((resolve, reject) => {
    safeLookup('example.com', { family: 4 }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(ipv4, { address: PUBLIC_V4, family: 4 });
});

test('createSafeLookup rejects a rebinding/private answer before connector callback succeeds', async () => {
  const safeLookup = createSafeLookup({
    lookup: lookupReturning([{ address: '169.254.169.254', family: 4 }]),
  });
  await assert.rejects(
    new Promise((resolve, reject) => {
      safeLookup('rebind.example', { family: 0 }, (error, address) => {
        if (error) reject(error);
        else resolve(address);
      });
    }),
    UrlPolicyError,
  );
});

test('safeFetch follows relative redirects and returns the final canonical URL', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: url.href, headers: Object.fromEntries(init.headers.entries()) });
    if (calls.length === 1) return response(302, '/final');
    return response(200);
  };

  const result = await safeFetch(
    'https://example.com/start',
    { headers: { Cookie: 'session=1' } },
    { fetchImpl, dispatcher: null },
  );
  assert.equal(result.url.href, 'https://example.com/final');
  assert.equal(result.response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers.cookie, 'session=1');
});

test('safeFetch strips sensitive headers when a redirect crosses origin', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: url.href, headers: Object.fromEntries(init.headers.entries()) });
    if (calls.length === 1) return response(302, 'https://cdn.example/video');
    return response(200);
  };

  await safeFetch(
    'https://origin.example/start',
    {
      headers: {
        Cookie: 'session=1',
        Authorization: 'Bearer secret',
        'Proxy-Authorization': 'Basic secret',
        'X-Api-Key': 'custom-secret',
        Referer: 'https://origin.example/page',
        Range: 'bytes=0-99',
      },
    },
    { fetchImpl, dispatcher: null },
  );

  assert.equal(calls[1].headers.cookie, undefined);
  assert.equal(calls[1].headers.authorization, undefined);
  assert.equal(calls[1].headers['proxy-authorization'], undefined);
  assert.equal(calls[1].headers['x-api-key'], undefined);
  assert.equal(calls[1].headers.referer, 'https://origin.example/page');
  assert.equal(calls[1].headers.range, 'bytes=0-99');
});

test('safeFetch blocks a redirect to a private literal before the unsafe transport call', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(302, 'http://127.0.0.1/admin');
  };

  await assert.rejects(
    safeFetch('https://example.com/start', {}, { fetchImpl, dispatcher: null }),
    UrlPolicyError,
  );
  assert.equal(calls, 1);
});

test('safeFetch applies authorization to every redirect hop before transport', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(302, 'https://other.example/video');
  };

  await assert.rejects(
    safeFetch('https://origin.example/start', {}, {
      fetchImpl,
      dispatcher: null,
      authorize: (url) => {
        if (url.origin !== 'https://origin.example') {
          throw new UrlPolicyError('TARGET_NOT_ALLOWED', 'target not allowed');
        }
      },
    }),
    /target not allowed/,
  );
  assert.equal(calls, 1);
});

test('safeFetch enforces the redirect hop limit', async () => {
  let calls = 0;
  const fetchImpl = async (_url) => {
    calls += 1;
    return response(302, `/hop-${calls}`);
  };

  await assert.rejects(
    safeFetch('https://example.com/start', {}, { fetchImpl, dispatcher: null }),
    (error) => error instanceof UrlPolicyError && error.code === 'REDIRECT_LIMIT',
  );
  assert.equal(calls, MAX_REDIRECTS + 1);
});
