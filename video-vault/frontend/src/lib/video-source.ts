// frontend/src/lib/video-source.ts
// 保存された URL を「アプリ内で再生できる埋め込み形式」に変換する。
//
// サポート:
//   - YouTube  (youtube.com / youtu.be / shorts)
//   - TikTok
//   - Niconico
//   - Vimeo
//   - 直リンク (.mp4 / .webm / .mov / .m4v)
//
// それ以外は `unsupported` を返し、UI 側で「元サイトで開く」フォールバックを出す。

export type PlayableType = 'iframe' | 'video' | 'unsupported';

export interface PlayableSource {
  type: PlayableType;
  /** type=iframe なら embed URL、video なら直リンク、unsupported なら元 URL */
  url: string;
  /** 元 URL (外部で開く / コピーする時に使う) */
  originalUrl: string;
  /** UI 表示用のサービス名 */
  serviceLabel?: string;
}

interface Matcher {
  label: string;
  match: (u: URL) => string | null;
  /** match の戻り値 (videoId) を embed URL に変換 */
  embed: (id: string) => string;
}

const MATCHERS: Matcher[] = [
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
  // youtu.be short
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
export function resolveSource(rawUrl: string): PlayableSource {
  let parsed: URL;
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

  // 直接の動画ファイル
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(parsed.pathname)) {
    return {
      type: 'video',
      url: rawUrl,
      originalUrl: rawUrl,
      serviceLabel: 'direct',
    };
  }

  return {
    type: 'unsupported',
    url: rawUrl,
    originalUrl: rawUrl,
  };
}
