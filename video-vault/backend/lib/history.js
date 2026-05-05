// lib/history.js
// view_history の取得・削除。

/**
 * @typedef {Object} HistoryEntry
 * @property {number} id
 * @property {number} video_id
 * @property {string} viewed_at
 * @property {string} title
 * @property {string} url
 * @property {string} site
 * @property {string|null} thumbnail_url
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ limit?: number, sinceDays?: number }} opts
 * @returns {HistoryEntry[]}
 */
export function findRecent(db, opts = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const conditions = [];
  const params = [];

  if (typeof opts.sinceDays === 'number' && opts.sinceDays > 0) {
    conditions.push("vh.viewed_at >= datetime('now', ? || ' days')");
    params.push(`-${Math.floor(opts.sinceDays)}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT vh.id, vh.video_id, vh.viewed_at,
           v.title, v.url, v.site, v.thumbnail_url
    FROM view_history vh
    JOIN videos v ON v.id = vh.video_id
    ${where}
    ORDER BY vh.viewed_at DESC
    LIMIT ${limit}
  `;
  return db.prepare(sql).all(...params);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ before?: string }} opts  before: ISO date 文字列 (これ以前を削除)。未指定なら全削除。
 * @returns {{ deleted: number }}
 */
export function clear(db, opts = {}) {
  if (opts.before) {
    const result = db
      .prepare('DELETE FROM view_history WHERE viewed_at < ?')
      .run(opts.before);
    return { deleted: result.changes };
  }
  const result = db.prepare('DELETE FROM view_history').run();
  return { deleted: result.changes };
}
