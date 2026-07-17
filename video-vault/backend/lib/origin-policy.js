// lib/origin-policy.js
// CORS と CSRF ガードで共有する許可 Origin リスト。
// (#6 CORS設定の厳格化 / #20 CSRF対策の追加)
//
// デフォルトはローカル開発用 Origin のみ。Tailscale Funnel 等で外部公開する場合は
// `ALLOWED_ORIGINS` (カンマ区切り) に Funnel の Origin (例: https://foo.tailxxxx.ts.net) を追加する。

const DEFAULT_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:3001',
  'http://localhost:3001',
];

/** @returns {Set<string>} */
export function getAllowedOrigins() {
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

/**
 * @param {string} origin
 * @returns {boolean}
 */
export function isAllowedOrigin(origin) {
  return getAllowedOrigins().has(origin);
}
