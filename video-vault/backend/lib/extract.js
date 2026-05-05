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

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 12_000;

// yt-dlp の場所 (Windows 専用、env で上書き可)
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'C:\\Users\\1kkim\\projects\\yt-dlp.exe';
const YT_DLP_TIMEOUT_MS = 20_000;

/**
 * @typedef {Object} ExtractedMedia
 * @property {string} url            動画 / playlist の URL
 * @property {string} mediaType      'video/mp4' | 'application/x-mpegURL' | etc
 * @property {string} [poster]       og:image など
 * @property {string} [title]
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
  const html = await fetchHtml(pageUrl);
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
  } catch {
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
 * @param {string} pageUrl
 * @returns {Promise<ExtractedMedia|null>}
 */
export async function extractMedia(pageUrl) {
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
  } catch {
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

  /** @type {{ url: string, ext: string, height?: number, protocol?: string }[]} */
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
  return out;
}

/**
 * @param {string} url
 */
async function fetchHtml(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return null;
    return await res.text();
  } catch {
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
