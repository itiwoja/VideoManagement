// lib/csrf-mw.js
// SameSite=Strict Cookie に加えた多層防御 (#20)。
// 状態変更系メソッドに対し Origin (無ければ Referer) が allowlist 内かを検証する。
// Authorization: Bearer 認証は ambient credential ではないため対象外
// (拡張機能・API トークンクライアントはブラウザの CSRF 脅威モデルの外側にある)。

import { isAllowedOrigin } from './origin-policy.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * @param {string|undefined} referer
 * @returns {string|null}
 */
function refererOrigin(referer) {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** @type {import('express').RequestHandler} */
export function csrfGuard(req, res, next) {
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return next();

  const origin = req.headers.origin || refererOrigin(req.headers.referer);
  if (!origin || !isAllowedOrigin(origin)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  return next();
}
