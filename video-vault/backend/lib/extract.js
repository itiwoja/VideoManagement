// lib/extract.js
// 任意の URL からページ HTML を取得し、再生可能な動画ファイル URL を抽出する。
//
// 対応戦略 (ヒット順):
//   1. og:video / og:video:url / og:video:secure_url
//   2. twitter:player:stream
//   3. JSON-LD VideoObject contentUrl
//   4. <video src>, <source src>
//   5. ページ HTML 内の .mp4 / .m3u8 / .webm 直接リンク
//
// 注意:
//   - 他人のサイトから動画 URL を抜き取るので、site 側が JavaScript で動的に
//     URL を組み立てる場合 (Brightcove, JW Player 等) はうまくいかない
//   - 抽出 URL は client が直接 fetch するので、Referer / Cookie が要る site
//     は再生不可 (今回はカバーしない)
//
// User-Agent はデスクトップ Chrome を装う (一部 site が UA で出し分けるため)。

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertPublicHttpUrl,
  isUrlPolicyError,
  safeFetch,
} from './safe-fetch.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 12_000;

/**
 * yt-dlp.exe のパスを解決する。
 * 優先順位: env YT_DLP_PATH > tools/yt-dlp.exe > root/yt-dlp.exe (legacy)
 * @returns {string}
 */
function resolveYtDlpPath() {
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH;
  const candidates = [
    'C:\\Users\\1kkim\\projects\\tools\\yt-dlp.exe',
    'C:\\Users\\1kkim\\projects\\yt-dlp.exe', // 旧位置 (後方互換)
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]; // fallback (spawn 時に明確なエラーで落ちる)
}

const YT_DLP_PATH = resolveYtDlpPath();
const YT_DLP_TIMEOUT_MS = 20_000;

/**
 * @typedef {Object} ExtractedMedia
 * @property {string} url            動画 / playlist の URL
 * @property {string} mediaType      'video/mp4' | 'application/x-mpegURL' | etc
 * @property {string} [poster]       og:image など
 * @property {string} [title]
 * @property {Record<string, string>} [httpHeaders]  upstream に送る必要がある headers (UA, Cookie, Referer 等)
 * @property {string} [referrer]     必要なら referer URL (ページ URL)
 */

/**
 * @typedef {Object} PageMetadata
 * @property {string} [title]
 * @property {string} [thumbnail]
 * @property {string} [siteName]
 */

/**
 * 軽量: og:image / og:title / og:site_name のみ取得する。
 * POST /videos で thumbnail_url / title が無いときの補完用。
 * 失敗時は空オブジェクトを返す (ベストエフォート)。
 * @param {string} pageUrl
 * @returns {Promise<PageMetadata>}
 */
export async function extractMetadata(pageUrl) {
  pageUrl = (await assertPublicHttpUrl(pageUrl)).href;

  // missav は普通の fetch だと Cloudflare 403 で空 → impersonate 経由で HTML 取得
  const html = isMissav(pageUrl)
    ? await fetchHtmlImpersonate(pageUrl)
    : await fetchHtml(pageUrl);
  /** @type {PageMetadata} */
  const out = {};

  if (html) {
    const meta = readMeta(html);
    const title = meta['og:title'] || meta['twitter:title'] || extractTitleTag(html);
    if (title) out.title = title;
    const thumb = meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'];
    if (thumb) {
      try {
        out.thumbnail = new URL(thumb, pageUrl).toString();
      } catch {
        out.thumbnail = thumb;
      }
    }
    if (meta['og:site_name']) out.siteName = meta['og:site_name'];
  }

  // og で title / thumbnail が両方取れたなら、それを返す
  if (out.title && out.thumbnail) return out;

  // 取れなかったら yt-dlp で補完を試みる (spankbang 等の bot ブロックサイト用)
  try {
    const ytdlp = await extractWithYtDlp(pageUrl);
    if (ytdlp) {
      if (!out.title && ytdlp.title) out.title = ytdlp.title;
      if (!out.thumbnail && ytdlp.poster) out.thumbnail = ytdlp.poster;
    }
  } catch (error) {
    if (isUrlPolicyError(error)) throw error;
    // 失敗時はそのまま (best effort)
  }

  return out;
}

/**
 * @param {string} html
 */
function extractTitleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  return m[1].trim().replace(/\s+/g, ' ') || undefined;
}

/**
 * 「HTML scrape より yt-dlp の方が信頼できる」 ホスト名のリスト。
 * - pornhub: og:video が iframe URL なので、ブラウザから iframe で開いてもプレーヤーが
 *   制限で動かない。yt-dlp なら mp4 直リンクが取れる。
 * - missav / spankbang / tktube / javrank: bot 防御 + JS 動的プレーヤーで HTML scrape
 *   が機能しない、yt-dlp 一択。
 * @param {string} pageUrl
 * @returns {boolean}
 */
function shouldPreferYtDlp(pageUrl) {
  let host;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const preferred = [
    'pornhub.com',
    'jp.pornhub.com',
    'spankbang.com',
    'jp.spankbang.com',
    'missav.ws',
    'missav.com',
    'tktube.com',
    'javrank.com',
    'xvideos.com',
    'xnxx.com',
    'xhamster.com',
    'redtube.com',
    'youporn.com',
  ];
  return preferred.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * missav.ws / missav.com 等の Cloudflare 防御 + 難読化 JS サイト判定。
 * @param {string} pageUrl
 */
function isMissav(pageUrl) {
  let host;
  try { host = new URL(pageUrl).hostname.toLowerCase(); }
  catch { return false; }
  return host === 'missav.ws' || host === 'missav.com'
    || host.endsWith('.missav.ws') || host.endsWith('.missav.com');
}

/**
 * @param {string} pageUrl
 * @returns {Promise<ExtractedMedia|null>}
 */
export async function extractMedia(pageUrl) {
  pageUrl = (await assertPublicHttpUrl(pageUrl)).href;

  // missav は Cloudflare 突破 + 難読化 JS 復号が必要なので専用ルート
  if (isMissav(pageUrl)) {
    try {
      const result = await extractMissav(pageUrl);
      if (result) return result;
    } catch (error) {
      if (isUrlPolicyError(error)) throw error;
      // フォールバックに流れる
    }
  }

  // 既知の "HTML scrape よりも yt-dlp が信頼できる" サイトは先に yt-dlp 試す
  if (shouldPreferYtDlp(pageUrl)) {
    try {
      const ytdlp = await extractWithYtDlp(pageUrl);
      if (ytdlp) return ytdlp;
    } catch (error) {
      if (isUrlPolicyError(error)) throw error;
      // 失敗したら HTML scrape に流れる
    }
  }

  const html = await fetchHtml(pageUrl);

  // HTML 取得できたら og:video / JSON-LD / <video src> / 直リンクを試す
  // (取れなかったら yt-dlp フォールバックへ)
  if (html) {
    const meta = readMeta(html);

    // 1. og:video 系
    const og =
      meta['og:video:secure_url'] ||
      meta['og:video:url'] ||
      meta['og:video'] ||
      meta['twitter:player:stream'] ||
      null;
    if (og && isPlayableUrl(og)) {
      return {
        url: absolute(pageUrl, og),
        mediaType: detectMediaType(og),
        poster: meta['og:image'] || undefined,
        title: meta['og:title'] || undefined,
      };
    }

    // 2. JSON-LD VideoObject
    const jsonLd = findJsonLdVideo(html);
    if (jsonLd) {
      return {
        url: absolute(pageUrl, jsonLd.url),
        mediaType: detectMediaType(jsonLd.url),
        poster: jsonLd.poster || meta['og:image'] || undefined,
        title: jsonLd.title || meta['og:title'] || undefined,
      };
    }

    // 3. <video src> / <source src>
    const videoTag = findVideoTagSrc(html);
    if (videoTag) {
      return {
        url: absolute(pageUrl, videoTag),
        mediaType: detectMediaType(videoTag),
        poster: meta['og:image'] || undefined,
        title: meta['og:title'] || undefined,
      };
    }

    // 4. direct .mp4 / .m3u8 / .webm
    const direct = findDirectMedia(html);
    if (direct) {
      return {
        url: absolute(pageUrl, direct),
        mediaType: detectMediaType(direct),
        poster: meta['og:image'] || undefined,
        title: meta['og:title'] || undefined,
      };
    }
  }

  // 5. yt-dlp フォールバック (HTML 取得失敗時 + 上の戦略全部失敗時)
  // spankbang / missav / tktube / javrank などの bot ブロック・JS 動的サイトで効く
  try {
    const ytdlp = await extractWithYtDlp(pageUrl);
    if (ytdlp) return ytdlp;
  } catch (error) {
    if (isUrlPolicyError(error)) throw error;
    // yt-dlp が無いか、タイムアウトした場合は無視
  }

  return null;
}

/**
 * yt-dlp.exe を child_process で起動し、JSON 出力から動画 URL を取り出す。
 * 1000+ サイトに対応 (YouTube、TikTok、各種 tube サイト等)。
 * @param {string} pageUrl
 * @returns {Promise<ExtractedMedia|null>}
 */
async function extractWithYtDlp(pageUrl) {
  pageUrl = (await assertPublicHttpUrl(pageUrl)).href;

  /** @type {Promise<{stdout: string, stderr: string, code: number}>} */
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      YT_DLP_PATH,
      ['-j', '--no-warnings', '--no-playlist', '--socket-timeout', '15', pageUrl],
      { windowsHide: true },
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('yt-dlp timeout'));
    }, YT_DLP_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });

  if (result.code !== 0 || !result.stdout) return null;

  /** @type {Record<string, unknown>} */
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    return null;
  }

  // 一番再生しやすい URL を選ぶ
  // 戦略:
  //   1. 直接 mp4 (https) で 720p 以下を優先 (帯域重視、スマホで再生しやすい)
  //   2. 720p mp4 が無ければ最低画質 mp4
  //   3. mp4 が無ければ HLS m3u8
  //   4. それも無ければトップレベルの url
  const formats = Array.isArray(data.formats) ? data.formats : [];

  /** @type {{ url: string, ext: string, height?: number, protocol?: string, http_headers?: Record<string, string>, cookies?: string }[]} */
  const candidates = [];
  for (const f of formats) {
    if (!f || typeof f !== 'object') continue;
    const url = typeof f.url === 'string' ? f.url : null;
    if (!url || !url.startsWith('http')) continue;
    candidates.push({
      url,
      ext: typeof f.ext === 'string' ? f.ext : '',
      height: typeof f.height === 'number' ? f.height : undefined,
      protocol: typeof f.protocol === 'string' ? f.protocol : undefined,
      http_headers: f.http_headers && typeof f.http_headers === 'object'
        ? /** @type {Record<string, string>} */ (f.http_headers)
        : undefined,
      cookies: typeof f.cookies === 'string' ? f.cookies : undefined,
    });
  }

  // mp4 (https protocol)、height ≦ 720 を優先
  const mp4Candidates = candidates
    .filter((c) => c.ext === 'mp4' && c.protocol !== 'm3u8_native' && c.protocol !== 'm3u8')
    .sort((a, b) => {
      // 720p に近いものを優先 (高すぎても低すぎても遠ざける)
      const ah = a.height ?? 1080;
      const bh = b.height ?? 1080;
      const aDist = Math.abs(ah - 720);
      const bDist = Math.abs(bh - 720);
      return aDist - bDist;
    });

  let chosen = mp4Candidates[0];

  // mp4 が取れなかったら HLS
  if (!chosen) {
    const hlsCandidates = candidates
      .filter((c) => c.protocol === 'm3u8_native' || c.protocol === 'm3u8')
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    chosen = hlsCandidates[0];
  }

  // それも無ければトップレベル URL
  if (!chosen) {
    const topUrl = typeof data.url === 'string' ? data.url : null;
    if (!topUrl) return null;
    chosen = { url: topUrl, ext: 'mp4', protocol: 'https' };
  }

  const isHls = chosen.protocol?.startsWith('m3u8') ?? false;
  const mediaType = isHls
    ? 'application/x-mpegURL'
    : chosen.ext === 'webm'
      ? 'video/webm'
      : 'video/mp4';

  /** @type {ExtractedMedia} */
  const out = {
    url: chosen.url,
    mediaType,
  };
  if (typeof data.title === 'string') out.title = data.title;
  // thumbnail は文字列 or thumbnails 配列の最初
  if (typeof data.thumbnail === 'string') {
    out.poster = data.thumbnail;
  } else if (Array.isArray(data.thumbnails) && data.thumbnails[0]?.url) {
    out.poster = String(data.thumbnails[0].url);
  }

  // upstream で必要なヘッダ (User-Agent, Referer, Cookie 等) を proxy 用に保持
  /** @type {Record<string, string>} */
  const headers = {};
  if (chosen.http_headers) {
    for (const [k, v] of Object.entries(chosen.http_headers)) {
      if (typeof v === 'string') headers[k] = v;
    }
  }
  // Cookie は yt-dlp の format.cookies に文字列で入る (Set-Cookie 形式) → ; で分割
  if (chosen.cookies) {
    // Set-Cookie の "name=value; Domain=...; Path=..." 形式から name=value だけ抽出
    const cookiePairs = chosen.cookies
      .split(/,\s*(?=[A-Za-z_]+=)/) // 複数 cookie は ", name=" で区切られる
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean);
    if (cookiePairs.length > 0) {
      headers['Cookie'] = cookiePairs.join('; ');
    }
  }
  // Referer はページ URL を強制セット (yt-dlp のヘッダに無くても付ける)
  if (!headers['Referer'] && !headers['referer']) {
    headers['Referer'] = pageUrl;
  }
  if (Object.keys(headers).length > 0) {
    out.httpHeaders = headers;
    out.referrer = pageUrl;
  }
  return out;
}

/**
 * @param {string} url
 */
async function fetchHtml(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { response: res } = await safeFetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.8',
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;
    return await res.text();
  } catch (error) {
    if (isUrlPolicyError(error)) throw error;
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * <meta property="..." content="..."> / name="..." content="..." を回収。
 * @param {string} html
 * @returns {Record<string, string>}
 */
function readMeta(html) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /<meta\s+([^>]+?)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const key = pick(attrs, /property=["']([^"']+)["']/i) || pick(attrs, /name=["']([^"']+)["']/i);
    const val = pick(attrs, /content=["']([^"']*)["']/i);
    if (key && val !== null) {
      // 同じキーが複数あるときは最初のを残す
      if (!out[key.toLowerCase()]) out[key.toLowerCase()] = val;
    }
  }
  return out;
}

/**
 * @param {string} html
 */
function findJsonLdVideo(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const json = JSON.parse(m[1]);
      const found = walkJsonLdForVideo(json);
      if (found) return found;
    } catch {
      // ignore parse errors
    }
  }
  return null;
}

function walkJsonLdForVideo(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = walkJsonLdForVideo(item);
      if (r) return r;
    }
    return null;
  }
  if (typeof node === 'object') {
    if ((node['@type'] === 'VideoObject' || node.type === 'VideoObject') && node.contentUrl) {
      return {
        url: String(node.contentUrl),
        title: typeof node.name === 'string' ? node.name : undefined,
        poster: typeof node.thumbnailUrl === 'string' ? node.thumbnailUrl : undefined,
      };
    }
    for (const v of Object.values(node)) {
      const r = walkJsonLdForVideo(v);
      if (r) return r;
    }
  }
  return null;
}

function findVideoTagSrc(html) {
  // 第一マッチ: <video src="...">
  let m = html.match(/<video[^>]*\ssrc=["']([^"']+)["'][^>]*>/i);
  if (m && isPlayableUrl(m[1])) return m[1];
  // 第二: <source src="...">
  m = html.match(/<source[^>]*\ssrc=["']([^"']+)["'][^>]*>/i);
  if (m && isPlayableUrl(m[1])) return m[1];
  return null;
}

function findDirectMedia(html) {
  // 優先順位: mp4 > m3u8 > webm
  const mp4 = html.match(/https?:\/\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?/i);
  if (mp4) return mp4[0];
  const m3u8 = html.match(/https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/i);
  if (m3u8) return m3u8[0];
  const webm = html.match(/https?:\/\/[^\s"'<>\\]+?\.webm(?:\?[^\s"'<>\\]*)?/i);
  if (webm) return webm[0];
  return null;
}

function pick(s, re) {
  const m = s.match(re);
  return m ? m[1] : null;
}

function isPlayableUrl(u) {
  if (!u) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  return /\.(mp4|webm|m3u8|mov|m4v)(\?|#|$)/i.test(u) || u.includes('embed');
}

function detectMediaType(u) {
  if (/\.mp4(\?|#|$)/i.test(u)) return 'video/mp4';
  if (/\.m3u8(\?|#|$)/i.test(u)) return 'application/x-mpegURL';
  if (/\.webm(\?|#|$)/i.test(u)) return 'video/webm';
  if (/\.mov(\?|#|$)/i.test(u)) return 'video/quicktime';
  return 'video/mp4';
}

function absolute(base, maybeRelative) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

// ============================================================================
// missav 専用 extractor
// ============================================================================

/**
 * yt-dlp の curl-cffi impersonate モードで Cloudflare 越しに HTML を取得する。
 * yt-dlp は missav 用 extractor を持たないため "Unsupported URL" エラーで終わるが、
 * --write-pages のおかげで HTML だけは取れている。それを読む。
 *
 * @param {string} pageUrl
 * @returns {Promise<string|null>}
 */
async function fetchHtmlImpersonate(pageUrl) {
  pageUrl = (await assertPublicHttpUrl(pageUrl)).href;

  const dir = mkdtempSync(join(tmpdir(), 'vv-imp-'));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        YT_DLP_PATH,
        [
          '--impersonate', 'chrome',
          '--write-pages',
          '--skip-download',
          '--no-warnings',
          '--socket-timeout', '15',
          pageUrl,
        ],
        // --write-pages は cwd に dump を書くので cwd=tmpdir に固定
        { windowsHide: true, cwd: dir },
      );
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('impersonate fetch timeout'));
      }, YT_DLP_TIMEOUT_MS);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        // missav 等は Unsupported URL で code=1 になるが、HTML ダンプは取れている
        resolve(code ?? -1);
      });
    });

    const files = readdirSync(dir);
    const dump = files.find((f) => f.endsWith('.dump'));
    if (!dump) return null;
    return readFileSync(join(dir, dump), 'utf-8');
  } catch {
    return null;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Dean Edwards "p,a,c,k,e,d" packer の復号。
 * eval(function(p,a,c,k,e,d){...}('PAYLOAD', BASE, COUNT, 'k1|k2|...'.split('|'),0,{}))
 * から PAYLOAD 内の `\b<base-N>\b` を辞書で置換した結果を返す。
 *
 * @param {string} html
 * @returns {string|null} 復号された JS、または null
 */
function decodeDeanPacker(html) {
  const m = html.match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/,
  );
  if (!m) return null;
  // payload 内のエスケープを戻す
  let payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  const base = parseInt(m[2], 10);
  const count = parseInt(m[3], 10);
  const dict = m[4].split('|');
  for (let c = count - 1; c >= 0; c--) {
    const word = dict[c];
    if (!word) continue;
    const key = c.toString(base);
    payload = payload.replace(new RegExp('\\b' + key + '\\b', 'g'), word);
  }
  return payload;
}

/**
 * missav.ws / missav.com の動画ページから master m3u8 URL を抽出する。
 *
 * @param {string} pageUrl
 * @returns {Promise<ExtractedMedia|null>}
 */
async function extractMissav(pageUrl) {
  const html = await fetchHtmlImpersonate(pageUrl);
  if (!html) return null;

  const decoded = decodeDeanPacker(html);
  if (!decoded) return null;

  // master playlist (`playlist.m3u8`) を最優先、無ければ任意の .m3u8
  const masterMatch = decoded.match(/https?:\/\/[^\s'"]+?\/playlist\.m3u8(?:\?[^\s'"]*)?/);
  const anyMatch = decoded.match(/https?:\/\/[^\s'"]+?\.m3u8(?:\?[^\s'"]*)?/);
  const m3u8Url = masterMatch ? masterMatch[0] : anyMatch ? anyMatch[0] : null;
  if (!m3u8Url) return null;

  const meta = readMeta(html);
  const title = meta['og:title'] || extractTitleTag(html);
  const poster = meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'];

  /** @type {ExtractedMedia} */
  const out = {
    url: m3u8Url,
    mediaType: 'application/x-mpegURL',
    httpHeaders: {
      'User-Agent': UA,
      'Referer': pageUrl,
    },
    referrer: pageUrl,
  };
  if (title) out.title = title;
  if (poster) {
    try { out.poster = new URL(poster, pageUrl).toString(); }
    catch { out.poster = poster; }
  }
  return out;
}
