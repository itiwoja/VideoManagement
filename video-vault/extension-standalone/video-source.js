// video-source.js
// 保存された URL を「アプリ内で再生できる埋め込み形式」に変換する。
// extension-standalone は backend を持たないので yt-dlp 経由の URL 抽出はできない。
// → iframe 埋め込み or 直リンク or 元サイトで開く の 3 択。

/**
 * @typedef {'iframe' | 'video' | 'unsupported'} PlayableType
 *
 * @typedef {Object} PlayableSource
 * @property {PlayableType} type
 * @property {string} url             type=iframe なら embed URL、video なら直リンク、unsupported なら元 URL
 * @property {string} originalUrl
 * @property {string} [serviceLabel]
 */

const MATCHERS = [
  // YouTube standard watch
  {
    label: 'YouTube',
    match: (u) => {
      if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/);
      return m ? m[1] : null;
    },
    embed: (id) => `https://www.youtube.com/embed/${id}?rel=0`,
  },
  // youtu.be 短縮
  {
    label: 'YouTube',
    match: (u) => {
      if (u.hostname !== 'youtu.be') return null;
      const m = u.pathname.match(/^\/([\w-]{6,})/);
      return m ? m[1] : null;
    },
    embed: (id) => `https://www.youtube.com/embed/${id}?rel=0`,
  },
  // TikTok
  {
    label: 'TikTok',
    match: (u) => {
      if (!/(^|\.)tiktok\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/video\/(\d{6,})/);
      return m ? m[1] : null;
    },
    embed: (id) => `https://www.tiktok.com/embed/v2/${id}`,
  },
  // Niconico
  {
    label: 'ニコニコ動画',
    match: (u) => {
      if (!/(^|\.)nicovideo\.jp$/.test(u.hostname)) return null;
      const m = u.pathname.match(/\/watch\/((sm|nm|so)?\d+)/);
      return m ? m[1] : null;
    },
    embed: (id) => `https://embed.nicovideo.jp/watch/${id}`,
  },
  // Vimeo
  {
    label: 'Vimeo',
    match: (u) => {
      if (!/(^|\.)vimeo\.com$/.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/(\d{6,})/);
      return m ? m[1] : null;
    },
    embed: (id) => `https://player.vimeo.com/video/${id}`,
  },
];

/**
 * @param {string} rawUrl
 * @returns {PlayableSource}
 */
export function resolveSource(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { type: 'unsupported', url: rawUrl, originalUrl: rawUrl };
  }

  for (const m of MATCHERS) {
    const id = m.match(parsed);
    if (id) {
      return {
        type: 'iframe',
        url: m.embed(id),
        originalUrl: rawUrl,
        serviceLabel: m.label,
      };
    }
  }

  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(parsed.pathname)) {
    return {
      type: 'video',
      url: rawUrl,
      originalUrl: rawUrl,
      serviceLabel: 'direct',
    };
  }

  return { type: 'unsupported', url: rawUrl, originalUrl: rawUrl };
}

/**
 * @param {string} rawUrl
 * @returns {string|null}  YouTube 等のサムネ URL を推定 (iframe 系のみ)
 */
export function guessThumbnail(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (/(^|\.)youtube\.com$/.test(parsed.hostname) && parsed.pathname === '/watch') {
    const id = parsed.searchParams.get('v');
    if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  if (parsed.hostname === 'youtu.be') {
    const m = parsed.pathname.match(/^\/([\w-]{6,})/);
    if (m) return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`;
  }
  return null;
}
