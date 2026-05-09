// server.js
// Express HTTP layer. ビジネスロジックは lib/* に分離。
// Requires Node.js 22.5+ for built-in node:sqlite.
//
// Phase 3: パスワード認証 + API トークン (lib/auth.js, auth-mw.js, rate-limit.js)。

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { openDb, migrate } from './lib/db.js';
import * as videosRepo from './lib/videos.js';
import * as tagsRepo from './lib/tags.js';
import * as historyRepo from './lib/history.js';
import {
  createApiToken,
  createSessionJwt,
  deleteApiToken,
  getPasswordHash,
  hashPassword,
  isInitialized,
  listApiTokens,
  sessionCookie,
  sessionCookieName,
  setPasswordHash,
  verifyPassword,
  verifySessionJwt,
} from './lib/auth.js';
import { requireAuth } from './lib/auth-mw.js';
import { rateLimit } from './lib/rate-limit.js';
import { extractMedia, extractMetadata } from './lib/extract.js';
import { saveProxyEntry, getProxyEntry } from './lib/proxy-store.js';

// ----------------------------------------------------- env validation (fail fast)
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.stderr.write(
    '[fatal] JWT_SECRET must be set (at least 32 chars). See backend/.env.example.\n',
  );
  process.exit(1);
}

// COOKIE_SECURE=true で常に Secure を強制 (本番 HTTPS-only 配信向け)。
// 通常は接続プロトコルから自動判定 (HTTP localhost は非 Secure、HTTPS Funnel は Secure)。
const COOKIE_SECURE_FORCE = process.env.COOKIE_SECURE === 'true';

const db = openDb();
migrate(db);

const app = express();

// X-Forwarded-Proto を信用 (Tailscale Funnel など reverse proxy 越しの HTTPS 検出用)
app.set('trust proxy', true);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ------------------------------------------------------------------ helpers
const errorResponse = (res, status, message) =>
  res.status(status).json({ ok: false, error: message });
const successResponse = (res, data) => res.json({ ok: true, data });

const parseId = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * リクエストが HTTPS で来てるか判定。reverse proxy の X-Forwarded-Proto も考慮。
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function isSecureConnection(req) {
  if (req.secure) return true;
  const xfp = req.headers['x-forwarded-proto'];
  if (typeof xfp === 'string' && xfp.split(',')[0].trim() === 'https') return true;
  return false;
}

function setSessionCookieOn(req, res) {
  const secure = COOKIE_SECURE_FORCE || isSecureConnection(req);
  const c = sessionCookie(secure);
  res.cookie(c.name, createSessionJwt(), c.options);
}

function clearSessionCookieOn(req, res) {
  const secure = COOKIE_SECURE_FORCE || isSecureConnection(req);
  const c = sessionCookie(secure);
  res.clearCookie(c.name, c.options);
}

// ------------------------------------------------------------------ public
// /health は認証不要。クライアントが backend 生死を見るだけなので情報も最小。
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, initialized: isInitialized(db) });
});

// ------------------------------------------------------------------ auth
const loginLimiter = rateLimit({ max: 5, windowMs: 60_000, keyPrefix: 'login' });
const setupLimiter = rateLimit({ max: 5, windowMs: 60_000, keyPrefix: 'setup' });

app.post('/api/auth/setup', setupLimiter, async (req, res) => {
  if (isInitialized(db)) {
    return errorResponse(res, 409, 'already initialized');
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return errorResponse(res, 400, 'password must be 8-128 chars');
  }
  try {
    const hash = await hashPassword(password);
    setPasswordHash(db, hash);
    setSessionCookieOn(req, res);
    return successResponse(res, { initialized: true });
  } catch (err) {
    return errorResponse(res, 500, 'setup failed');
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  if (!isInitialized(db)) {
    return errorResponse(res, 409, 'not initialized');
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 1) {
    return errorResponse(res, 401, 'unauthorized');
  }
  const stored = getPasswordHash(db);
  if (!stored) return errorResponse(res, 401, 'unauthorized');

  const ok = await verifyPassword(password, stored);
  if (!ok) return errorResponse(res, 401, 'unauthorized');

  setSessionCookieOn(req, res);
  return successResponse(res, { ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookieOn(req, res);
  return successResponse(res, { ok: true });
});

// 認証状態確認 (UI ロード時の判定用、未認証でも 200 で authenticated:false)
app.get('/api/auth/me', (req, res) => {
  const cookieToken = req.cookies?.[sessionCookieName()];
  const ok = verifySessionJwt(cookieToken);
  return res.json({
    ok: true,
    data: { authenticated: ok, initialized: isInitialized(db) },
  });
});

// パスワード変更 (要認証)
app.post('/api/auth/change', requireAuth(db), async (req, res) => {
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || typeof next !== 'string') {
    return errorResponse(res, 400, 'current and next required');
  }
  if (next.length < 8 || next.length > 128) {
    return errorResponse(res, 400, 'password must be 8-128 chars');
  }
  const stored = getPasswordHash(db);
  if (!stored || !(await verifyPassword(current, stored))) {
    return errorResponse(res, 401, 'unauthorized');
  }
  const newHash = await hashPassword(next);
  setPasswordHash(db, newHash);
  setSessionCookieOn(req, res);
  return successResponse(res, { ok: true });
});

// API tokens (要認証)
app.get('/api/auth/tokens', requireAuth(db), (_req, res) => {
  return successResponse(res, { tokens: listApiTokens(db) });
});

app.post('/api/auth/tokens', requireAuth(db), (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string') {
    return errorResponse(res, 400, 'name required');
  }
  const created = createApiToken(db, name);
  // 生 token はここでだけ返す
  return successResponse(res, {
    id: created.id,
    name: created.name,
    token: created.token,
    note: 'token はこの 1 度だけ表示されます。コピーして保存してください。',
  });
});

app.delete('/api/auth/tokens/:id', requireAuth(db), (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return errorResponse(res, 400, 'invalid id');
  const ok = deleteApiToken(db, id);
  if (!ok) return errorResponse(res, 404, 'not found');
  return successResponse(res, { deleted: true });
});

// ------------------------------------------------------------------ protected: videos
const protectedRouter = express.Router();
protectedRouter.use(requireAuth(db));

protectedRouter.get('/videos', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const sort = (req.query.sort || 'added_at').toString();
  const tag = (req.query.tag || '').toString().trim();

  const ratingRaw = req.query.rating;
  const ratingExact =
    ratingRaw !== undefined && ratingRaw !== '' ? Number(ratingRaw) : undefined;
  const ratingMinRaw = req.query.rating_min;
  const ratingMin =
    ratingMinRaw !== undefined && ratingMinRaw !== '' ? Number(ratingMinRaw) : undefined;
  const unratedOnly = req.query.unrated === '1';

  const filters = {
    q: q || undefined,
    sort,
    tag: tag || undefined,
    ratingExact: Number.isFinite(ratingExact) ? ratingExact : undefined,
    ratingMin: Number.isFinite(ratingMin) ? ratingMin : undefined,
    unratedOnly,
  };
  res.json({ videos: videosRepo.findAll(db, filters) });
});

protectedRouter.post('/videos', async (req, res) => {
  const { url, title, thumbnail_url, duration } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }

  // PWA 共有経由 (Service Worker) や bookmarklet 経由では og:image / og:title が
  // 取れていないことがある。ここで best-effort に補完する。失敗しても保存は続行。
  let finalTitle = typeof title === 'string' && title.length > 0 ? title : null;
  let finalThumb = typeof thumbnail_url === 'string' && thumbnail_url.length > 0 ? thumbnail_url : null;

  if (!finalTitle || !finalThumb) {
    try {
      const meta = await extractMetadata(url);
      if (!finalTitle && meta.title) finalTitle = meta.title;
      if (!finalThumb && meta.thumbnail) finalThumb = meta.thumbnail;
    } catch {
      // ignore - best effort
    }
  }

  // それでも title が無ければ URL を fallback に
  if (!finalTitle) finalTitle = url;

  try {
    const result = videosRepo.create(db, {
      url,
      title: finalTitle,
      thumbnail_url: finalThumb,
      duration,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 既存動画のサムネ補完 (NULL の動画について og:image を取得して埋める)。
// 一気にやるとサイトに負荷がかかるので 1 リクエスト最大 20 件。
protectedRouter.post('/videos/enrich-thumbnails', async (_req, res) => {
  const targets = videosRepo.findMissingThumbnails(db, 20);
  let updated = 0;
  for (const t of targets) {
    try {
      const meta = await extractMetadata(t.url);
      if (meta.thumbnail) {
        const v = videosRepo.setThumbnail(db, t.id, meta.thumbnail);
        if (v) updated += 1;
      }
    } catch {
      // skip individual failures
    }
  }
  return successResponse(res, { scanned: targets.length, updated });
});

// 任意 URL から再生可能な動画 URL を抽出する (アプリ内プレイヤー用)。
// upstream で Cookie / Referer 等が必要な場合は、proxy URL に変換して返す。
protectedRouter.post('/extract', async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== 'string' || url.length === 0) {
    return errorResponse(res, 400, 'url required');
  }
  try {
    new URL(url);
  } catch {
    return errorResponse(res, 400, 'invalid url');
  }
  try {
    const media = await extractMedia(url);
    if (!media) return errorResponse(res, 404, 'no playable media found');

    // ヘッダが必要なら proxy URL に変換 (yt-dlp 経路は大抵必要)
    if (media.httpHeaders && Object.keys(media.httpHeaders).length > 0) {
      const token = saveProxyEntry({
        url: media.url,
        headers: media.httpHeaders,
        mediaType: media.mediaType,
      });
      return successResponse(res, {
        ...media,
        url: `/api/stream/${token}`,
        httpHeaders: undefined, // クライアントには返さない
        referrer: undefined,
        proxied: true,
      });
    }

    // ヘッダ不要 (og:video 直リンク・YouTube embed 等) はそのまま
    return successResponse(res, media);
  } catch (err) {
    return errorResponse(res, 500, err instanceof Error ? err.message : 'extract failed');
  }
});

// 認証付き proxy: 抽出した動画 URL を upstream の正しいヘッダで fetch して stream する。
// `<video src="/api/stream/<token>">` で再生されることを想定。
// Range リクエスト対応 (シーク用)。
// HLS (m3u8) の場合は中身を rewrite して segment URL も proxy 経由にする。
//
// クエリパラメータ `?u=<base64url>` で sub-resource URL を指定可能 (m3u8 セグメント等)。
// 親 token のヘッダを継承して fetch する。
protectedRouter.get('/stream/:token', async (req, res) => {
  const entry = getProxyEntry(req.params.token);
  if (!entry) return errorResponse(res, 404, 'token not found or expired');

  // ?u= が指定されていればそれを fetch、なければ entry.url を fetch
  let targetUrl = entry.url;
  const sub = typeof req.query.u === 'string' ? req.query.u : null;
  if (sub) {
    try {
      targetUrl = Buffer.from(sub, 'base64url').toString('utf8');
      new URL(targetUrl); // validation
    } catch {
      return errorResponse(res, 400, 'invalid sub-resource url');
    }
  }

  // Range は upstream にそのまま転送 (シーク・部分再生のため)
  const upstreamHeaders = { ...entry.headers };
  if (req.headers.range) {
    upstreamHeaders['Range'] = String(req.headers.range);
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    const upstreamCT = upstream.headers.get('content-type') || '';
    const looksLikeM3u8 =
      upstreamCT.includes('mpegurl') ||
      upstreamCT.includes('mpegURL') ||
      /\.m3u8(\?|#|$)/i.test(targetUrl);

    if (looksLikeM3u8 && upstream.body) {
      // HLS playlist: 中身を全部読んで segment / variant URL を rewrite
      const text = await upstream.text();
      const baseUrl = new URL(targetUrl);
      const rewritten = rewriteM3u8(text, baseUrl, req.params.token);

      res.status(upstream.status);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      res.send(rewritten);
      return;
    }

    res.status(upstream.status);
    // 通すべきレスポンスヘッダ
    const passthroughHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'last-modified',
      'etag',
    ];
    for (const h of passthroughHeaders) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    // Content-Type は entry.mediaType を優先 (upstream が誤った type を返すケースあり)
    if (
      !sub &&
      entry.mediaType &&
      !upstream.headers.get('content-type')?.startsWith('video')
    ) {
      res.setHeader('Content-Type', entry.mediaType);
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    // ReadableStream を Node の res に流す
    const reader = upstream.body.getReader();
    res.on('close', () => {
      reader.cancel().catch(() => {});
    });
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(value);
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      return errorResponse(
        res,
        502,
        `upstream error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    res.end();
  }
});

/**
 * HLS m3u8 のテキストを受け取り、segment / variant URL を proxy URL に書き換える。
 * @param {string} text         m3u8 の本文
 * @param {URL} baseUrl         m3u8 自身の URL (相対パス解決用)
 * @param {string} parentToken  /api/stream/<token> の token
 * @returns {string} 書き換え済み m3u8
 */
function rewriteM3u8(text, baseUrl, parentToken) {
  /** @param {string} maybeUrl */
  const toProxy = (maybeUrl) => {
    let abs;
    try {
      abs = new URL(maybeUrl, baseUrl).toString();
    } catch {
      return maybeUrl;
    }
    const enc = Buffer.from(abs, 'utf8').toString('base64url');
    return `/api/stream/${parentToken}?u=${enc}`;
  };

  const lines = text.split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw;
    if (!line || line.startsWith('#')) {
      // タグ行: URI="..." を含む可能性 (#EXT-X-KEY, #EXT-X-MAP 等)
      const replaced = line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${toProxy(u)}"`);
      out.push(replaced);
      continue;
    }
    // 空行以外の URL 行
    if (line.trim().length === 0) {
      out.push(line);
      continue;
    }
    out.push(toProxy(line.trim()));
  }
  return out.join('\n');
}

protectedRouter.patch('/videos/:id', (req, res) => {
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

protectedRouter.post('/videos/:id/view', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  const result = videosRepo.recordView(db, id);
  if (!result.viewed) return res.status(404).json({ error: 'not found' });
  res.json({ video: result.video });
});

protectedRouter.delete('/videos/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: 'invalid id' });
  const ok = videosRepo.remove(db, id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// ------------------------------------------------------------------ protected: tags
protectedRouter.get('/tags', (_req, res) => {
  return successResponse(res, { tags: tagsRepo.findAll(db) });
});

protectedRouter.post('/videos/:id/tags', (req, res) => {
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

protectedRouter.delete('/videos/:videoId/tags/:tagId', (req, res) => {
  const videoId = parseId(req.params.videoId);
  const tagId = parseId(req.params.tagId);
  if (videoId === null || tagId === null) {
    return errorResponse(res, 400, 'invalid id');
  }
  const ok = tagsRepo.detachFromVideo(db, videoId, tagId);
  if (!ok) return errorResponse(res, 404, 'not attached');
  return successResponse(res, { detached: true });
});

// ------------------------------------------------------------------ protected: history
protectedRouter.get('/history', (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const sinceDays = req.query.since_days ? Number(req.query.since_days) : undefined;
  const entries = historyRepo.findRecent(db, {
    limit: Number.isFinite(limit) ? limit : undefined,
    sinceDays: Number.isFinite(sinceDays) ? sinceDays : undefined,
  });
  return successResponse(res, { entries });
});

protectedRouter.delete('/history', (req, res) => {
  const before = req.query.before ? String(req.query.before) : undefined;
  const result = historyRepo.clear(db, { before });
  return successResponse(res, result);
});

app.use('/api', protectedRouter);

// ------------------------------------------------------------------ start
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  process.stdout.write(`video-vault backend listening on http://${HOST}:${PORT}\n`);
});

export { app, db };
