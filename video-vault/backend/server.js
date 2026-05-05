// server.js
// Express HTTP layer. ビジネスロジックは lib/* に分離。
// Requires Node.js 22.5+ for built-in node:sqlite.

import express from 'express';
import cors from 'cors';
import { openDb, migrate } from './lib/db.js';
import * as videosRepo from './lib/videos.js';
import * as tagsRepo from './lib/tags.js';
import * as historyRepo from './lib/history.js';

const db = openDb();
migrate(db);

const app = express();

// Allow all origins. This server only ever binds to localhost (127.0.0.1).
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ------------------------------------------------------------------ helpers
const errorResponse = (res, status, message) =>
  res.status(status).json({ ok: false, error: message });
const successResponse = (res, data) => res.json({ ok: true, data });

const parseId = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ------------------------------------------------------------------ health
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ------------------------------------------------------------------ videos
app.get('/api/videos', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const sort = (req.query.sort || 'added_at').toString();
  const tag = (req.query.tag || '').toString().trim();
  const ratingMinRaw = req.query.rating_min;
  const ratingMin =
    ratingMinRaw !== undefined && ratingMinRaw !== '' ? Number(ratingMinRaw) : undefined;
  const unratedOnly = req.query.unrated === '1';

  const filters = {
    q: q || undefined,
    sort,
    tag: tag || undefined,
    ratingMin: Number.isFinite(ratingMin) ? ratingMin : undefined,
    unratedOnly,
  };

  const videos = videosRepo.findAll(db, filters);
  res.json({ videos });
});

app.post('/api/videos', (req, res) => {
  const { url, title, thumbnail_url, duration } = req.body || {};
  if (!url || !title) {
    return res.status(400).json({ error: 'url and title are required' });
  }
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }

  try {
    const result = videosRepo.create(db, { url, title, thumbnail_url, duration });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/videos/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return errorResponse(res, 400, 'invalid id');

  const { title, rating, note } = req.body || {};
  const patch = {};
  if (typeof title === 'string') patch.title = title;
  if (rating === null) patch.rating = null;
  else if (typeof rating === 'number') {
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      return errorResponse(res, 400, 'rating must be 0..5 or null');
    }
    patch.rating = rating;
  }
  if (note === null || typeof note === 'string') patch.note = note;

  const video = videosRepo.update(db, id, patch);
  if (!video) return errorResponse(res, 404, 'not found');
  return successResponse(res, { video });
});

app.post('/api/videos/:id/view', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });

  const result = videosRepo.recordView(db, id);
  if (!result.viewed) return res.status(404).json({ error: 'not found' });
  res.json({ video: result.video });
});

app.delete('/api/videos/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  const ok = videosRepo.remove(db, id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ tags
app.get('/api/tags', (_req, res) => {
  const tags = tagsRepo.findAll(db);
  return successResponse(res, { tags });
});

app.post('/api/videos/:id/tags', (req, res) => {
  const videoId = parseId(req.params.id);
  if (videoId === null) return errorResponse(res, 400, 'invalid id');

  const { name } = req.body || {};
  if (typeof name !== 'string' || name.trim().length === 0) {
    return errorResponse(res, 400, 'name is required');
  }
  if (!videosRepo.findById(db, videoId)) {
    return errorResponse(res, 404, 'video not found');
  }

  try {
    const tag = tagsRepo.attachToVideo(db, videoId, name);
    return successResponse(res, { tag });
  } catch (err) {
    return errorResponse(res, 400, err.message);
  }
});

app.delete('/api/videos/:videoId/tags/:tagId', (req, res) => {
  const videoId = parseId(req.params.videoId);
  const tagId = parseId(req.params.tagId);
  if (videoId === null || tagId === null) {
    return errorResponse(res, 400, 'invalid id');
  }
  const ok = tagsRepo.detachFromVideo(db, videoId, tagId);
  if (!ok) return errorResponse(res, 404, 'not attached');
  return successResponse(res, { detached: true });
});

// ------------------------------------------------------------------ history
app.get('/api/history', (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const sinceDays = req.query.since_days ? Number(req.query.since_days) : undefined;
  const entries = historyRepo.findRecent(db, {
    limit: Number.isFinite(limit) ? limit : undefined,
    sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
  });
  return successResponse(res, { entries });
});

app.delete('/api/history', (req, res) => {
  const before = req.query.before ? String(req.query.before) : undefined;
  const result = historyRepo.clear(db, { before });
  return successResponse(res, result);
});

// ------------------------------------------------------------------ start
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`video-vault backend listening on http://127.0.0.1:${PORT}\n`);
});

export { app, db };
