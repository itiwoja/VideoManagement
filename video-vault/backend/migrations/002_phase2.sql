-- 002_phase2.sql
-- Phase 2: タグ / 評価 / メモ / 視聴履歴。
-- node:sqlite は 1 ファイル単位で複数文を exec できる。
-- ALTER TABLE は IF NOT EXISTS が使えないので migrate.js 側で sqlite_master チェックする。

-- (column 追加は migrate.js が PRAGMA user_version で 2 未満のときだけ実行する)

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS video_tags (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_video_tags_video ON video_tags(video_id);
CREATE INDEX IF NOT EXISTS idx_video_tags_tag ON video_tags(tag_id);

CREATE TABLE IF NOT EXISTS view_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  viewed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_view_history_video ON view_history(video_id);
CREATE INDEX IF NOT EXISTS idx_view_history_viewed_at ON view_history(viewed_at DESC);
