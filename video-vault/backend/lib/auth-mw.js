// lib/auth-mw.js
// 認証ミドルウェア。Cookie の JWT または Authorization: Bearer (API token) を受け付ける。
// 認証失敗は 401 + 単一のメッセージ ("unauthorized") のみ。詳細は漏らさない。

import { sessionCookieName, verifyApiToken, verifySessionJwt } from './auth.js';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {import('express').RequestHandler}
 */
export function requireAuth(db) {
  return (req, res, next) => {
    // 1. Cookie 経由
    const cookieToken = req.cookies?.[sessionCookieName()];
    if (cookieToken && verifySessionJwt(cookieToken)) {
      return next();
    }

    // 2. Authorization: Bearer 経由 (API tokens)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (verifyApiToken(db, token)) {
        return next();
      }
    }

    return res.status(401).json({ ok: false, error: 'unauthorized' });
  };
}
