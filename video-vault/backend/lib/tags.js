// lib/tags.js
// tags + video_tags の操作。

import { syncVideoFts } from './search-index.js';

/**
 * @typedef {Object} TagWithCount
 * @property {number} id
 * @property {string} name
 * @property {number} count
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {TagWithCount[]}
 */
export function findAll(db) {
  return db
    .prepare(
      `SELECT t.id AS id, t.name AS name,
              (SELECT COUNT(*) FROM video_tags vt WHERE vt.tag_id = t.id) AS count
       FROM tags t
       ORDER BY count DESC, t.name ASC`
    )
    .all();
}

/**
 * Find or create a tag by name (case-insensitive match on stored lower form).
 * The stored name preserves the original casing of the first time it was created.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} rawName
 * @returns {{ id: number, name: string }}
 */
export function findOrCreate(db, rawName) {
  const name = rawName.trim();
  if (name.length === 0) {
    throw new Error('tag name cannot be empty');
  }
  if (name.length > 64) {
    throw new Error('tag name too long (max 64)');
  }

  // case-insensitive match on existing rows
  const existing = db
    .prepare('SELECT id, name FROM tags WHERE LOWER(name) = LOWER(?)')
    .get(name);
  if (existing) return existing;

  const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name);
  return { id: Number(result.lastInsertRowid), name };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} videoId
 * @param {string} name
 * @returns {{ id: number, name: string }|null}
 */
export function attachToVideo(db, videoId, name) {
  const tag = findOrCreate(db, name);
  // INSERT OR IGNORE で重複は黙って弾く
  db.prepare(
    'INSERT OR IGNORE INTO video_tags (video_id, tag_id) VALUES (?, ?)'
  ).run(videoId, tag.id);
  syncVideoFts(db, videoId); // #12: タグは videos_fts の検索対象にも含む
  return tag;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} videoId
 * @param {number} tagId
 * @returns {boolean}
 */
export function detachFromVideo(db, videoId, tagId) {
  const result = db
    .prepare('DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?')
    .run(videoId, tagId);
  if (result.changes > 0) syncVideoFts(db, videoId);
  return result.changes > 0;
}
