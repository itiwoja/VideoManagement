-- 001_init.sql
-- 初期スキーマ。既存の data.db でも安全に走る (IF NOT EXISTS)。

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  duration TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_added_at ON videos(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_site ON videos(site);
