// lib/videos.js
// videos リソースの読み書き (Repository パターン)。
//
// 関数の責務はクエリ + 整形のみ。HTTP / バリデーションは routes 側に委ねる。

import { syncVideoFts, removeFromFts, ftsPhraseQuery } from './search-index.js';
import { deleteCachedThumbnail } from './thumbnail-cache.js';

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
 * @property {boolean} [brokenOnly]       true なら link_status = 'broken' のみ (#8)
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
    const q = filters.q.trim();
    if (q.length >= 3) {
      // FTS5 (trigram) — title/note/tags 横断。3文字未満は trigram がマッチできないので LIKE にフォールバック。
      conditions.push('v.id IN (SELECT rowid FROM videos_fts WHERE videos_fts MATCH ?)');
      params.push(ftsPhraseQuery(q));
    } else if (q.length > 0) {
      const like = `%${q}%`;
      conditions.push(
        `(v.title LIKE ? OR v.site LIKE ? OR v.note LIKE ?
          OR v.id IN (SELECT vt.video_id FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE t.name LIKE ?))`
      );
      params.push(like, like, like, like);
    }
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

  // ゴミ箱に入っている(deleted_at IS NOT NULL)動画は通常一覧には出さない (#10)
  conditions.push('v.deleted_at IS NULL');

  if (filters.brokenOnly) {
    conditions.push("v.link_status = 'broken'");
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
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
    const id = Number(result.lastInsertRowid);
    syncVideoFts(db, id);
    const video = findById(db, id);
    return { video, created: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = db.prepare('SELECT * FROM videos WHERE url = ?').get(url);
      // ゴミ箱に入っていた動画を再度保存しようとした場合は、複製ではなく復元として扱う (#10)
      if (existing.deleted_at !== null) {
        db.prepare('UPDATE videos SET deleted_at = NULL WHERE id = ?').run(existing.id);
        const video = findById(db, existing.id);
        return { video, created: false, duplicate: false, restored: true };
      }
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
  syncVideoFts(db, id);
  return findById(db, id);
}

/**
 * thumbnail_url のみを後追いで更新するための専用ヘルパー。
 * og:image を後からサーバ側で取得した時に使う。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @param {string} thumbnailUrl
 * @returns {Video|null}
 */
export function setThumbnail(db, id, thumbnailUrl) {
  const result = db
    .prepare('UPDATE videos SET thumbnail_url = ? WHERE id = ? AND thumbnail_url IS NULL')
    .run(thumbnailUrl, id);
  if (result.changes === 0) return null;
  return findById(db, id);
}

/**
 * thumbnail_url が NULL の動画 ID 一覧。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} [limit]
 * @returns {{ id: number, url: string }[]}
 */
export function findMissingThumbnails(db, limit = 50) {
  const rows = db
    .prepare('SELECT id, url FROM videos WHERE thumbnail_url IS NULL LIMIT ?')
    .all(limit);
  return rows.map((r) => ({ id: Number(r.id), url: String(r.url) }));
}

/**
 * thumbnail_url が外部 URL (まだローカルキャッシュしていない) の動画一覧 (#7)。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} [limit]
 * @returns {{ id: number, thumbnailUrl: string }[]}
 */
export function findRemoteThumbnails(db, limit = 20) {
  const rows = db
    .prepare(
      `SELECT id, thumbnail_url FROM videos
       WHERE deleted_at IS NULL AND thumbnail_url LIKE 'http%'
       LIMIT ?`
    )
    .all(limit);
  return rows.map((r) => ({ id: Number(r.id), thumbnailUrl: String(r.thumbnail_url) }));
}

/**
 * ローカルキャッシュ後の thumbnail_url に書き換える (#7)。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @param {string} localPath  `/thumbs/xxx.jpg`
 */
export function setCachedThumbnail(db, id, localPath) {
  db.prepare('UPDATE videos SET thumbnail_url = ? WHERE id = ?').run(localPath, id);
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
 * ゴミ箱に移動する(論理削除)。物理削除はしない (#10)。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {boolean}
 */
export function remove(db, id) {
  const result = db
    .prepare('UPDATE videos SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL')
    .run(id);
  return result.changes > 0;
}

/**
 * ゴミ箱の一覧(削除日の新しい順)。
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Video[]}
 */
export function findTrash(db) {
  const rows = db
    .prepare('SELECT * FROM videos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
    .all();
  return attachTags(db, rows);
}

/**
 * ゴミ箱から復元する。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {Video|null}
 */
export function restore(db, id) {
  const result = db
    .prepare('UPDATE videos SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
    .run(id);
  if (result.changes === 0) return null;
  return findById(db, id);
}

/**
 * ゴミ箱の動画を完全に削除する(元に戻せない)。誤操作防止のため、
 * 既にゴミ箱に入っている動画のみ対象(通常の一覧からは物理削除できない)。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {boolean}
 */
export function purge(db, id) {
  const row = db.prepare('SELECT thumbnail_url FROM videos WHERE id = ? AND deleted_at IS NOT NULL').get(id);
  if (!row) return false;
  const result = db.prepare('DELETE FROM videos WHERE id = ? AND deleted_at IS NOT NULL').run(id);
  if (result.changes > 0) {
    removeFromFts(db, id);
    deleteCachedThumbnail(row.thumbnail_url); // #7: ローカルキャッシュしたサムネ画像も掃除する
  }
  return result.changes > 0;
}

/**
 * リンク切れチェックが必要な動画 (未チェック、または days 日以上前にチェック済み)。
 * ゴミ箱に入っている動画は対象外。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} limit
 * @param {number} [days]
 * @returns {{ id: number, url: string }[]}
 */
export function findStaleLinkChecks(db, limit = 20, days = 7) {
  const rows = db
    .prepare(
      `SELECT id, url FROM videos
       WHERE deleted_at IS NULL
         AND (link_checked_at IS NULL OR link_checked_at <= datetime('now', ?))
       ORDER BY link_checked_at IS NOT NULL, link_checked_at ASC
       LIMIT ?`
    )
    .all(`-${Math.floor(days)} days`, limit);
  return rows.map((r) => ({ id: Number(r.id), url: String(r.url) }));
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @param {'ok'|'broken'|'unknown'} status
 */
export function setLinkStatus(db, id, status) {
  db.prepare('UPDATE videos SET link_status = ?, link_checked_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    status,
    id,
  );
}

/**
 * 30日以上前にゴミ箱入りした動画を自動で完全削除する。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} [days]
 * @returns {number} 削除件数
 */
export function purgeExpiredTrash(db, days = 30) {
  const result = db
    .prepare(`DELETE FROM videos WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', ?)`)
    .run(`-${Math.floor(days)} days`);
  return result.changes;
}
