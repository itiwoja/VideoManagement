// lib/playlists.js
// プレイリスト (#16): タグとは別に、動画へ手動の並び順を持たせたグループ。

/**
 * @typedef {Object} Playlist
 * @property {number} id
 * @property {string} name
 * @property {string} created_at
 * @property {number} video_count
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Playlist[]}
 */
export function findAll(db) {
  return db
    .prepare(
      `SELECT p.id AS id, p.name AS name, p.created_at AS created_at,
              (SELECT COUNT(*) FROM playlist_videos pv WHERE pv.playlist_id = p.id) AS video_count
       FROM playlists p
       ORDER BY p.created_at DESC`
    )
    .all();
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {Playlist|null}
 */
export function findById(db, id) {
  const row = db
    .prepare(
      `SELECT p.id AS id, p.name AS name, p.created_at AS created_at,
              (SELECT COUNT(*) FROM playlist_videos pv WHERE pv.playlist_id = p.id) AS video_count
       FROM playlists p WHERE p.id = ?`
    )
    .get(id);
  return row ?? null;
}

/**
 * プレイリストに入っている動画を並び順どおりに返す。
 * ゴミ箱に入っている動画は除外する。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} playlistId
 * @returns {Array<import('./videos.js').Video & { position: number }>}
 */
export function findVideos(db, playlistId) {
  const rows = db
    .prepare(
      `SELECT v.*, pv.position AS position
       FROM playlist_videos pv
       JOIN videos v ON v.id = pv.video_id
       WHERE pv.playlist_id = ? AND v.deleted_at IS NULL
       ORDER BY pv.position ASC`
    )
    .all(playlistId);

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const tagRows = db
    .prepare(
      `SELECT vt.video_id AS video_id, t.name AS name
       FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
       WHERE vt.video_id IN (${placeholders})
       ORDER BY t.name ASC`
    )
    .all(...ids);
  const tagsByVideo = new Map();
  for (const r of tagRows) {
    const arr = tagsByVideo.get(r.video_id) ?? [];
    arr.push(r.name);
    tagsByVideo.set(r.video_id, arr);
  }
  return rows.map((r) => ({ ...r, tags: tagsByVideo.get(r.id) ?? [] }));
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} name
 * @returns {Playlist}
 */
export function create(db, name) {
  const clean = (name || '').trim().slice(0, 128);
  if (clean.length === 0) throw new Error('playlist name cannot be empty');
  const result = db.prepare('INSERT INTO playlists (name) VALUES (?)').run(clean);
  return findById(db, Number(result.lastInsertRowid));
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @param {string} name
 * @returns {Playlist|null}
 */
export function rename(db, id, name) {
  const clean = (name || '').trim().slice(0, 128);
  if (clean.length === 0) throw new Error('playlist name cannot be empty');
  const result = db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(clean, id);
  if (result.changes === 0) return null;
  return findById(db, id);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {boolean}
 */
export function remove(db, id) {
  const result = db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * 末尾に動画を追加する。既に入っていれば何もしない (冪等)。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} playlistId
 * @param {number} videoId
 * @returns {boolean} 追加できたら true (既に入っていた場合は false)
 */
export function addVideo(db, playlistId, videoId) {
  const maxPos = db
    .prepare('SELECT MAX(position) AS maxPos FROM playlist_videos WHERE playlist_id = ?')
    .get(playlistId);
  const nextPos = (maxPos?.maxPos ?? -1) + 1;
  const result = db
    .prepare('INSERT OR IGNORE INTO playlist_videos (playlist_id, video_id, position) VALUES (?, ?, ?)')
    .run(playlistId, videoId, nextPos);
  return result.changes > 0;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} playlistId
 * @param {number} videoId
 * @returns {boolean}
 */
export function removeVideo(db, playlistId, videoId) {
  const result = db
    .prepare('DELETE FROM playlist_videos WHERE playlist_id = ? AND video_id = ?')
    .run(playlistId, videoId);
  return result.changes > 0;
}

/**
 * 並び順を丸ごと置き換える。渡された videoId 配列の順序で position を 0 から振り直す。
 * プレイリストに実際に入っている動画だけを対象にする(不正な id は無視)。
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} playlistId
 * @param {number[]} videoIds
 */
export function reorder(db, playlistId, videoIds) {
  const existing = new Set(
    db
      .prepare('SELECT video_id FROM playlist_videos WHERE playlist_id = ?')
      .all(playlistId)
      .map((r) => r.video_id)
  );
  const update = db.prepare(
    'UPDATE playlist_videos SET position = ? WHERE playlist_id = ? AND video_id = ?'
  );
  let pos = 0;
  for (const videoId of videoIds) {
    if (!existing.has(videoId)) continue;
    update.run(pos, playlistId, videoId);
    pos += 1;
  }
}
