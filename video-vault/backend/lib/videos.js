// lib/videos.js
// videos リソースの読み書き (Repository パターン)。
//
// 関数の責務はクエリ + 整形のみ。HTTP / バリデーションは routes 側に委ねる。

/**
 * @typedef {Object} Video
 * @property {number} id
 * @property {string} url
 * @property {string} site
 * @property {string} title
 * @property {string|null} thumbnail_url
 * @property {string|null} duration
 * @property {string} added_at
 * @property {number} view_count
 * @property {string|null} last_viewed_at
 * @property {number|null} rating
 * @property {string|null} note
 * @property {string[]} tags
 */

/**
 * @typedef {Object} VideoFilters
 * @property {string} [q]                 タイトル/サイトのあいまい検索
 * @property {'added_at'|'view_count'|'last_viewed_at'} [sort]
 * @property {string} [tag]               1 タグでフィルタ
 * @property {number} [ratingExact]       完全一致 (frontend デフォルト)
 * @property {number} [ratingMin]         この評価以上に絞り込み (互換維持)
 * @property {boolean} [unratedOnly]      true なら rating IS NULL のみ
 */

const ALLOWED_SORT = new Set(['added_at', 'view_count', 'last_viewed_at']);

function attachTags(db, videos) {
  if (videos.length === 0) return videos;
  const ids = videos.map((v) => v.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT vt.video_id AS video_id, t.name AS name
       FROM video_tags vt
       JOIN tags t ON t.id = vt.tag_id
       WHERE vt.video_id IN (${placeholders})
       ORDER BY t.name ASC`
    )
    .all(...ids);

  const grouped = new Map();
  for (const r of rows) {
    const arr = grouped.get(r.video_id) ?? [];
    arr.push(r.name);
    grouped.set(r.video_id, arr);
  }
  return videos.map((v) => ({ ...v, tags: grouped.get(v.id) ?? [] }));
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {VideoFilters} filters
 * @returns {Video[]}
 */
export function findAll(db, filters = {}) {
  const sort = ALLOWED_SORT.has(filters.sort ?? '') ? filters.sort : 'added_at';
  const conditions = [];
  /** @type {Array<string|number>} */
  const params = [];

  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push('(v.title LIKE ? OR v.site LIKE ?)');
    params.push(like, like);
  }

  if (filters.tag) {
    conditions.push(
      'v.id IN (SELECT video_id FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE t.name = ?)'
    );
    params.push(filters.tag);
  }

  if (filters.unratedOnly) {
    conditions.push('v.rating IS NULL');
  } else if (typeof filters.ratingExact === 'number') {
    conditions.push('v.rating = ?');
    params.push(filters.ratingExact);
  } else if (typeof filters.ratingMin === 'number') {
    conditions.push('v.rating >= ?');
    params.push(filters.ratingMin);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT v.* FROM videos v
    ${where}
    ORDER BY v.${sort} IS NULL, v.${sort} DESC
  `;
  const rows = db.prepare(sql).all(...params);
  return attachTags(db, rows);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {Video|null}
 */
export function findById(db, id) {
  const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  if (!row) return null;
  return attachTags(db, [row])[0];
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ url: string, title: string, thumbnail_url?: string|null, duration?: string|null }} input
 * @returns {{ video: Video, created: boolean, duplicate?: boolean }}
 */
export function create(db, input) {
  const { url, title, thumbnail_url = null, duration = null } = input;
  const site = new URL(url).hostname.replace(/^www\./, '');

  const stmt = db.prepare(
    `INSERT INTO videos (url, site, title, thumbnail_url, duration)
     VALUES (?, ?, ?, ?, ?)`
  );
  try {
    const result = stmt.run(url, site, title, thumbnail_url, duration);
    const video = findById(db, Number(result.lastInsertRowid));
    return { video, created: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = db.prepare('SELECT * FROM videos WHERE url = ?').get(url);
      const video = attachTags(db, [existing])[0];
      return { video, created: false, duplicate: true };
    }
    throw err;
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @param {{ title?: string, rating?: number|null, note?: string|null }} patch
 * @returns {Video|null}
 */
export function update(db, id, patch) {
  const sets = [];
  const params = [];

  if (typeof patch.title === 'string' && patch.title.length > 0) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.rating === null || (typeof patch.rating === 'number' && patch.rating >= 0 && patch.rating <= 5)) {
    sets.push('rating = ?');
    params.push(patch.rating);
  }
  if (patch.note === null || typeof patch.note === 'string') {
    sets.push('note = ?');
    params.push(patch.note);
  }

  if (sets.length === 0) {
    return findById(db, id);
  }

  params.push(id);
  const result = db
    .prepare(`UPDATE videos SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
  if (result.changes === 0) return null;
  return findById(db, id);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {{ video: Video|null, viewed: boolean }}
 */
export function recordView(db, id) {
  const exists = db.prepare('SELECT id FROM videos WHERE id = ?').get(id);
  if (!exists) return { video: null, viewed: false };

  db.prepare(
    `UPDATE videos
     SET view_count = view_count + 1,
         last_viewed_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(id);

  db.prepare('INSERT INTO view_history (video_id) VALUES (?)').run(id);

  return { video: findById(db, id), viewed: true };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {boolean}
 */
export function remove(db, id) {
  const result = db.prepare('DELETE FROM videos WHERE id = ?').run(id);
  return result.changes > 0;
}
