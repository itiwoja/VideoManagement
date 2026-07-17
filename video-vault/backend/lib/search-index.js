// lib/search-index.js
// videos_fts (FTS5, trigram tokenizer) の同期処理 (#12)。
//
// 単一プロセス・単一ライターのローカルアプリなので、SQL トリガーではなく
// videos / tags の書き込み経路 (create/update/purge/attachTag/detachFromVideo) から
// 明示的に呼び出す方式で同期する。trigram tokenizer を使うのは、日本語は単語分割
// できない (unicode61 だと文の連続文字が1トークンになり部分一致が効かない) ため。
// ただし trigram は 3文字未満のクエリにマッチできない制約があるので、
// 呼び出し側 (videos.js の findAll) で短いクエリは LIKE にフォールバックする。

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} videoId
 */
export function syncVideoFts(db, videoId) {
  const video = db.prepare('SELECT title, note FROM videos WHERE id = ?').get(videoId);
  if (!video) return;
  const tagRow = db
    .prepare(
      `SELECT GROUP_CONCAT(t.name, ' ') AS names
       FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
       WHERE vt.video_id = ?`
    )
    .get(videoId);
  const tagsText = tagRow?.names ?? '';

  db.prepare('DELETE FROM videos_fts WHERE rowid = ?').run(videoId);
  db.prepare('INSERT INTO videos_fts(rowid, title, note, tags_text) VALUES (?, ?, ?, ?)').run(
    videoId,
    video.title ?? '',
    video.note ?? '',
    tagsText,
  );
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} videoId
 */
export function removeFromFts(db, videoId) {
  db.prepare('DELETE FROM videos_fts WHERE rowid = ?').run(videoId);
}

/**
 * FTS5 の MATCH クエリとして安全な形にする (フレーズとして丸ごとクォート)。
 * ユーザー入力に `"` `-` `AND` 等の FTS5 演算子が混じっていても構文エラーにならないよう、
 * 常にダブルクォートで囲んだフレーズ検索として扱う。
 * @param {string} q
 * @returns {string}
 */
export function ftsPhraseQuery(q) {
  return `"${q.replace(/"/g, '""')}"`;
}
