# Codex Brief: Issue #5 SSRF protection and stream URL scoping

## Context

- GitHub issue: https://github.com/itiwoja/VideoManagement/issues/5
- Branch: `fix/issue-5-ssrf-protection`
- Backend: Node.js 22.13+, Express 4, ESM, built-in `node:test` and `node:sqlite`
- Package manager / lockfile: pnpm / `video-vault/backend/pnpm-lock.yaml`
- Current defect:
  - `POST /api/extract` accepts any syntactically valid URL and passes it to native `fetch` and `yt-dlp`.
  - Native fetches follow redirects without inspecting DNS answers or redirect targets.
  - `GET /api/stream/:token?u=...` accepts any decodable URL and forwards saved upstream headers.
  - HLS rewriting emits proxy URLs but does not record which child URLs were actually present in a manifest.

## Objective

Close the SSRF/open-proxy paths described by Issue #5 while preserving normal extraction, Range streaming, and nested HLS playback. All server-side native HTTP egress influenced by a user or upstream manifest must use one fail-closed URL policy. A stream token may fetch its root origin plus exact cross-origin URLs discovered in successfully processed HLS manifests; it must not become an arbitrary public proxy.

## Threat model

### Trust boundaries

1. Authenticated request body `url` entering `/api/extract`, `/api/videos`, and metadata enrichment.
2. Query parameter `u` entering `/api/stream/:token`.
3. DNS answers and HTTP redirect `Location` values.
4. URLs and headers returned by `yt-dlp`.
5. HLS manifest lines and `URI="..."` attributes returned by upstream servers.

### Assets / abuse cases

- Prevent access to loopback, LAN, link-local/cloud metadata, carrier-grade NAT, and other non-global address space.
- Prevent non-HTTP schemes and credential-bearing URLs.
- Prevent a mixed DNS answer from hiding a private address behind a public one.
- Prevent a public URL or allowed stream target from redirecting to a forbidden address or token-external target.
- Prevent forged `u` values from sending saved Cookie/Authorization headers to arbitrary origins.
- Prevent malformed base64url aliases from bypassing capability comparisons.
- Bound redirect and manifest-derived authorization growth.

## Required architecture decisions

### 1. One native egress boundary

Add `video-vault/backend/lib/safe-fetch.js` (name may vary only if equally clear) and route all relevant in-process HTTP fetches through it.

The module must provide testable primitives with dependency injection:

- Parse/canonicalize an HTTP URL:
  - accept only exact `http:` and `https:`;
  - reject username/password;
  - reject overlong URLs (maximum 8192 UTF-16 code units is acceptable);
  - drop the fragment for canonical identity while preserving path and query;
  - rely on WHATWG `URL` canonicalization so alternate IPv4 forms such as `2130706433`, `0x7f000001`, and `0177.0.0.1` become canonical before address checks.
- Classify IP literals with `node:net` (`isIP` and `BlockList`) and reject non-global ranges.
- Resolve hostnames with `dns.promises.lookup(hostname, { all: true, order: 'verbatim' })`; reject zero answers, resolution failure, or the entire hostname if **any** returned A/AAAA address is blocked.
- Use a custom Undici dispatcher/Agent connector lookup so the socket receives the already-inspected answer set. Do not validate with one lookup and then let the connector perform an unrelated unrestricted lookup.
- Follow redirects manually (`redirect: 'manual'`), resolve relative `Location` values, re-run URL/DNS policy and the optional token authorization callback on every hop, and stop after at most 5 redirects.
- Cancel/discard redirect response bodies before continuing.
- On a cross-origin redirect, retain only an explicit playback-safe request-header allowlist; custom credentials such as `X-Api-Key` must not cross origins.
- Restrict this helper to the GET/HEAD behavior used by this repository; do not build a generic HTTP client.

Use exact dependency `undici@7.28.0` and update the pnpm lockfile through pnpm, not by hand. It is compatible with the repository's Node floor and exposes a documented Dispatcher/Agent boundary. Do not add `ipaddr.js`; the Node standard library is sufficient.

At minimum block these IPv4 ranges (also when represented as IPv4-mapped IPv6):

- `0.0.0.0/8`
- `10.0.0.0/8`
- `100.64.0.0/10`
- `127.0.0.0/8`
- `169.254.0.0/16`
- `172.16.0.0/12`
- `192.0.0.0/24`
- `192.0.2.0/24`
- `192.88.99.0/24`
- `192.168.0.0/16`
- `198.18.0.0/15`
- `198.51.100.0/24`
- `203.0.113.0/24`
- `224.0.0.0/4`
- `240.0.0.0/4`

At minimum block these IPv6 ranges:

- for non-mapped IPv6, allow only the current IANA **ALLOCATED** aggregate prefixes inside `2000::/3`; fail closed for reserved gaps, while public IPv4-mapped addresses remain governed by the IPv4 rules
- `::/96`, while still checking IPv4-mapped addresses against the IPv4 rules rather than blocking all public mapped IPv4
- `64:ff9b::/96` and `64:ff9b:1::/48`
- `100::/64` and `100:0:0:1::/64`
- `2001::/23`, `2001:2::/48`, `2001:10::/28`, `2001:20::/28`, `2001:db8::/32`
- `2002::/16`
- `3fff::/20` and `5f00::/16`
- `fc00::/7`
- `fe80::/10`
- `fec0::/10`
- `ff00::/8`

Important `BlockList` detail: do **not** add `::ffff:0:0/96` as a blanket blocked subnet to the same denylist; use a separate detector so public mapped IPv4 can still be judged by the IPv4 rules. Cover this with tests.

Source comments for non-obvious runtime behavior should cite:

- https://nodejs.org/docs/latest-v22.x/api/dns.html#dnspromiseslookuphostname-options
- https://nodejs.org/docs/latest-v22.x/api/net.html#class-netblocklist
- https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml
- https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml
- https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.xhtml
- https://developer.mozilla.org/en-US/docs/Web/API/Request/redirect
- https://github.com/nodejs/undici/blob/v7.28.0/docs/docs/api/Agent.md
- https://github.com/nodejs/undici/blob/v7.28.0/docs/docs/api/Client.md#parameter-clientoptions

### 2. Extraction boundary

- Validate the page URL with the shared public-HTTP policy before any native fetch or `yt-dlp` spawn in both `extractMedia()` and `extractMetadata()`.
- Replace `fetchHtml()`'s unrestricted native `fetch(..., { redirect: 'follow' })` with the shared safe fetch.
- Do not swallow URL-policy errors into a normal `null` extraction result; preserve a recognizable policy error so API routes can return a generic client-safe denial.
- Validate any extracted media URL before creating a proxy entry. A private/non-HTTP derived URL must never be saved as a server-fetchable capability.
- `/api/extract` error contract:
  - missing URL: keep `400 url required`;
  - malformed, credential-bearing, or non-HTTP(S): `400 invalid url`;
  - syntactically valid but blocked address/DNS policy: `403 url not allowed`;
  - do not echo the rejected URL, IP, DNS answer, or internal exception.
- Apply the same shared validation inside the extraction functions, not only in the `/api/extract` route, because `/api/videos` and `/videos/enrich-thumbnails` call `extractMetadata()` directly.

#### Explicit process-boundary decision

`yt-dlp` performs its own DNS, redirects, and extractor-discovered requests. JavaScript validation and the Undici dispatcher cannot pin that child process's connections. For this issue-sized patch:

- keep current provider compatibility and generic fallback behavior;
- require shared initial URL validation before every `yt-dlp` spawn;
- require validation of every returned media URL before the server stores/fetches it;
- do **not** claim that this eliminates DNS rebinding or a public-to-private redirect occurring entirely inside `yt-dlp`;
- do not add a local CONNECT proxy or silently remove broad yt-dlp support in this patch. Process-level egress filtering is a separate hardening task.

This residual is a documented scope boundary, not permission to leave the native fetch or stream paths partially protected.

### 3. Stream-token authorization

Extend `video-vault/backend/lib/proxy-store.js` so each entry stores:

- canonical root URL;
- root origin;
- upstream headers and media type;
- expiry;
- a Set of exact manifest-discovered canonical URLs.

Policy required by Issue #5:

- the bare token fetches the root URL;
- a `u` target on the root URL's origin is allowed;
- a cross-origin `u` target is allowed only when its exact canonical URL (path and query included, fragment ignored) was registered from a successfully fetched HLS manifest;
- a query/path mutation of a registered cross-origin URL is denied;
- redirects are checked with the same rule on every hop; a redirect does not grant trust to a new origin;
- global public-HTTP/DNS policy always wins, even for a manifest-listed URL;
- saved `Cookie`, `Authorization`, and `Proxy-Authorization` headers are removed for an initially cross-origin manifest-listed target; Range remains the only client-derived upstream header added by the route.
- cross-origin requests retain only the explicit safe header allowlist (`Accept`/language/cache conditionals, `Origin`, `Referer`, `User-Agent`, and `Range`); arbitrary `X-*` credentials are removed.

Add an atomic batch registration function. Cap manifest-derived URLs at 10,000 references and 4 MiB of canonical URL text per token, with a 64 MiB process-wide storage ceiling. If canonicalization, policy, or a cap fails, add none of the batch.

### 4. Strict sub-resource encoding

Move proxy URL encode/decode and HLS rewriting into a focused testable module such as `video-vault/backend/lib/hls-proxy.js`.

- Accept only canonical unpadded base64url (`A-Z a-z 0-9 _ -`).
- Validate the raw wire query before Express decoding, then reject padding, whitespace, percent-encoded aliases, `%`, `+`, `/`, impossible length modulo 4, invalid UTF-8, non-round-tripping encodings, duplicate/non-string `u`, and decoded URLs over the URL length cap.
- Preserve path and query; ignore fragments for identity.

`GET /api/stream/:token` contract:

- expired/unknown token remains `404`;
- malformed `u` is `400 invalid sub-resource url`;
- syntactically valid but token-external or globally unsafe target is `403 sub-resource url not allowed`;
- upstream transport failures remain `502`, but do not expose internal addresses/policy details.

### 5. Transactional HLS processing

- Resolve non-comment media lines and every `URI="..."` attribute against the **final fetched manifest URL** after safe redirects.
- Support nested master -> variant -> segment/key/map flow: a fetched, already-authorized child manifest may register its own children on the same token.
- First parse/canonicalize the complete manifest and build the rewritten text plus discovered URL Set without mutating the store.
- Only after the whole manifest is valid and the token cap can accept the batch, register all URLs and send the rewritten response.
- On any invalid URI or cap failure, register nothing and return a generic 502.
- Require a complete successful non-206 response beginning with `#EXTM3U`; known manifests never receive Range, and an unexpectedly partial manifest is refetched without Range then rejected if still partial.
- Limit a manifest response body to 2 MiB before/while reading using storage proportional to body bytes, not chunk count.
- Cap URI occurrences at 10,000 and rewritten output at 4 MiB, checking output incrementally so one tag line cannot create a large temporary expansion.

## Measurable acceptance criteria

1. `file:`, `data:`, `ftp:`, `gopher:`, credential-bearing URLs, malformed URLs, and URLs over the cap are rejected before transport.
2. Canonical alternate loopback IPv4 forms (`127.1`, integer, hex, octal) are rejected.
3. All listed IPv4/IPv6 non-global ranges and mapped-private IPv6 are rejected; representative public IPv4 and IPv6 are accepted.
4. DNS with only public answers is accepted; zero/error or any mixed private answer is rejected.
5. The production connector's lookup callback returns only the inspected answer set to the socket connector; tests demonstrate the callback rejects a simulated rebinding/private answer before connect.
6. Native public -> private redirects, relative redirect chains that end private, and redirect loops/>5 hops fail before the unsafe hop.
7. `/api/extract` and metadata helpers cannot reach a private/non-HTTP initial URL; policy errors are not converted into extraction 404s or raw 500 messages.
8. A derived private media URL cannot be saved in `proxy-store` or fetched by `/api/stream`.
9. Forged cross-origin `u` is denied without calling transport; same-root-origin `u` follows the Issue contract; exact manifest-listed cross-origin URL is allowed.
10. Cross-origin registered URL mutations are denied, while fragments do not create separate grants.
11. Nested manifests authorize only children actually discovered when each parent was fetched; key/map URI attributes are covered.
12. Strict base64url malformed/alias forms, percent-encoded wire aliases, and duplicate `u` are rejected.
13. Private/non-HTTP HLS targets remain unfetchable even if the manifest lists them.
14. Cross-origin targets and redirects receive only the playback-safe header allowlist; Cookie/Authorization/custom credential headers do not cross origins. Range forwarding for media and normal same-origin playback remain intact.
15. Manifest parsing/registration is atomic and bounded (2 MiB input, 4 MiB output, 10,000 references, 4 MiB canonical URL storage/token, 64 MiB process-wide storage).
16. Tests are offline and deterministic: no live DNS, Internet, or yt-dlp calls.
17. `pnpm test` executes the new unit suites even when the integration server on port 3001 is absent; no test is reported as skipped/disabled to hide a failure.
18. `pnpm audit --prod` has no critical/high finding introduced by this change.

## Test-first incremental slices

### Slice 1: Public URL and safe redirect policy

**RED:** add focused tests for parsing, IP matrix, all-answer DNS, connector lookup, manual redirect revalidation, origin header stripping, and hop cap.

**GREEN:** add the safe-fetch module and exact Undici dependency. Update the test script so all `test/*.test.js` files execute.

**Verify:** run only the new safe-fetch suite, then full backend tests.

### Slice 2: Token capability model and strict encoding

**RED:** add tests for root origin, exact cross-origin grants, mutation denial, atomic cap, expiry, strict base64url, and cross-origin sensitive-header filtering.

**GREEN:** extend proxy store and add the focused proxy/HLS helper module.

**Verify:** run proxy/HLS suites, then full backend tests.

### Slice 3: Transactional nested HLS flow

**RED:** add manifest tests for relative lines, variant/segment nesting, key/map URI attributes, unsafe schemes/literals, final redirect base URL, size/cap, and no partial grant.

**GREEN:** wire transactional rewrite/registration and bounded body reading.

**Verify:** HLS suites and full backend tests.

### Slice 4: Route and extraction wiring

**RED:** add pure-policy/transport-spy tests proving denied input causes zero fetch/spawn calls and error mapping remains generic.

**GREEN:** wire `extract.js` and `server.js` to the shared policy; validate derived media before proxy creation; use token authorization on every stream redirect.

**Verify:** full backend tests plus syntax/import checks.

## Files expected to change

- `.ai/codex_brief_issue-5-ssrf.md` (this brief; do not rewrite its requirements)
- `video-vault/backend/package.json`
- `video-vault/backend/pnpm-lock.yaml`
- `video-vault/backend/lib/safe-fetch.js` (new)
- `video-vault/backend/lib/hls-proxy.js` (new)
- `video-vault/backend/lib/http-policy.js` (new)
- `video-vault/backend/lib/proxy-stream.js` (new)
- `video-vault/backend/lib/proxy-store.js`
- `video-vault/backend/lib/extract.js`
- `video-vault/backend/lib/db.js` (optional DB path injection for in-memory integration tests only)
- `video-vault/backend/server.js`
- `video-vault/README.md` (truthful Node.js floor)
- `.gitignore` (`*.tsbuildinfo` build artifact)
- focused new files under `video-vault/backend/test/`
- `video-vault/backend/test/videos.test.js` only if needed to stop its current `process.exit(0)` skip pattern from masking other suites

## Files / systems not to touch

- frontend, extension, extension-standalone, bookmarklet
- database schema, migrations, repositories, auth logic, CORS, rate limiting
- yt-dlp path/update Issue #2 work
- existing open PR #1
- GitHub Issue/PR state, remote branches, deployment
- unrelated debug script cleanup

## Required verification commands

Run from `video-vault/backend` unless noted:

1. `pnpm install --frozen-lockfile`
2. Targeted new test files during each RED/GREEN slice; record that each RED test failed for the intended missing behavior.
3. `pnpm test`
4. Run the full suite with the declared floor: `npx --yes node@22.13.0 --no-warnings --test "test/*.test.js"`
5. `node --check server.js`
6. `node --check lib/safe-fetch.js`
7. `node --check lib/hls-proxy.js`
8. `pnpm audit --prod`
9. From `video-vault/frontend`: `pnpm install --frozen-lockfile && pnpm build`
10. From repository root: `git diff --check`
11. From repository root: inspect `git diff --stat`, `git diff`, and `git status --short` for scope and secrets.

Do not make a commit, push, close the issue, or alter PR #1. The orchestrating agent will review and decide integration after verification.
