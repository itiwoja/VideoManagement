// Requires Node.js 22.5+ for built-in node:sqlite.
// Run with:  node --no-warnings server.js   (to suppress experimental warning)
import express from 'express';
import cors from 'cors';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, 'data.db'));

// --- Schema -----------------------------------------------------------------
db.exec(`
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
`);

// --- App --------------------------------------------------------------------
const app = express();

// Allow all origins. This server should only ever bind to localhost.
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// List / search videos
app.get('/api/videos', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const sort = (req.query.sort || 'added_at').toString();

  const sortColumn =
    sort === 'view_count'
      ? 'view_count'
      : sort === 'last_viewed_at'
      ? 'last_viewed_at'
      : 'added_at';

  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db
      .prepare(
        `SELECT * FROM videos
         WHERE title LIKE ? OR site LIKE ?
         ORDER BY ${sortColumn} IS NULL, ${sortColumn} DESC`
      )
      .all(like, like);
  } else {
    rows = db
      .prepare(
        `SELECT * FROM videos
         ORDER BY ${sortColumn} IS NULL, ${sortColumn} DESC`
      )
      .all();
  }

  res.json({ videos: rows });
});

// Add a video (used by bookmarklet)
app.post('/api/videos', (req, res) => {
  const { url, title, thumbnail_url, duration } = req.body || {};

  if (!url || !title) {
    return res.status(400).json({ error: 'url and title are required' });
  }

  let site;
  try {
    site = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }

  try {
    const stmt = db.prepare(
      `INSERT INTO videos (url, site, title, thumbnail_url, duration)
       VALUES (?, ?, ?, ?, ?)`
    );
    const result = stmt.run(url, site, title, thumbnail_url || null, duration || null);
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(result.lastInsertRowid);
    res.json({ video, created: true });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = db.prepare('SELECT * FROM videos WHERE url = ?').get(url);
      return res.json({ video: existing, created: false, duplicate: true });
    }
    res.status(500).json({ error: err.message });
  }
});

// Increment view count
app.post('/api/videos/:id/view', (req, res) => {
  const id = Number(req.params.id);
  const result = db
    .prepare(
      `UPDATE videos
       SET view_count = view_count + 1,
           last_viewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'not found' });
  }
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
  res.json({ video });
});

// Delete a video
app.delete('/api/videos/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM videos WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({ ok: true });
});

// --- Start ------------------------------------------------------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`video-vault backend listening on http://127.0.0.1:${PORT}`);
});
