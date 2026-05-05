// lib/rate-limit.js
// 軽量な in-memory レート制限。
// プロセス再起動でクリアされる。複数インスタンス展開なら Redis 等に置き換える。

/**
 * @typedef {Object} Bucket
 * @property {number} count
 * @property {number} resetAt   epoch ms
 */

const buckets = new Map();

/**
 * @param {string} key
 * @param {{ max: number, windowMs: number }} cfg
 * @returns {{ allowed: boolean, retryAfterSec: number }}
 */
export function tryConsume(key, cfg) {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + cfg.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (existing.count >= cfg.max) {
    const retryAfterMs = existing.resetAt - now;
    return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Express middleware factory。
 * @param {{ max?: number, windowMs?: number, keyPrefix?: string }} [opts]
 * @returns {import('express').RequestHandler}
 */
export function rateLimit(opts = {}) {
  const max = opts.max ?? 5;
  const windowMs = opts.windowMs ?? 60_000;
  const prefix = opts.keyPrefix ?? '';

  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${prefix}:${ip}`;
    const r = tryConsume(key, { max, windowMs });
    if (!r.allowed) {
      res.setHeader('Retry-After', String(r.retryAfterSec));
      return res
        .status(429)
        .json({ ok: false, error: 'too many requests', retry_after_sec: r.retryAfterSec });
    }
    next();
  };
}
