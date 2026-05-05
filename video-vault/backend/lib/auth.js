// lib/auth.js
// パスワード hash / 検証 / セッション JWT / API トークン管理。
//
// セキュリティ方針 (ECC `security-reviewer` 観点):
//   - JWT_SECRET は env から取得、未設定なら起動失敗
//   - bcrypt コスト >= 10 (既定 12)、env で 10〜14 に変更可
//   - JWT 有効期間 14 日
//   - エラーメッセージは原因を漏らさない単一トーン
//   - パスワードはハッシュのみ DB に保存、ログにも出さない
//   - API トークンは sha256 で hash 保存、生 token は発行時にしか出さない

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const COOKIE_NAME = 'vv_session';
const JWT_AUDIENCE = 'video-vault';
const SESSION_TTL_DAYS = 14;

function getJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to a string of at least 32 chars. See backend/.env.example.',
    );
  }
  return s;
}

function getBcryptCost() {
  const raw = process.env.BCRYPT_COST;
  if (!raw) return 12;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 10 || n > 14) return 12;
  return n;
}

/**
 * @param {string} plain
 * @returns {Promise<string>}
 */
export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8 || plain.length > 128) {
    throw new Error('password must be 8-128 chars');
  }
  return bcrypt.hash(plain, getBcryptCost());
}

/**
 * @param {string} plain
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false;
  // bcrypt.compare は内部で固定時間比較 (timing attack 対策)
  return bcrypt.compare(plain, hash);
}

/**
 * @returns {string} signed session JWT
 */
export function createSessionJwt() {
  return jwt.sign({ scope: 'session' }, getJwtSecret(), {
    audience: JWT_AUDIENCE,
    expiresIn: `${SESSION_TTL_DAYS}d`,
  });
}

/**
 * @param {string|undefined|null} token
 * @returns {boolean}
 */
export function verifySessionJwt(token) {
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { audience: JWT_AUDIENCE });
    return Boolean(decoded && typeof decoded === 'object' && decoded.scope === 'session');
  } catch {
    return false;
  }
}

/**
 * Cookie 属性の単一定義。
 * @param {boolean} secure
 * @returns {{name: string, options: import('express').CookieOptions}}
 */
export function sessionCookie(secure) {
  return {
    name: COOKIE_NAME,
    options: {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    },
  };
}

export function sessionCookieName() {
  return COOKIE_NAME;
}

// -------------------------------------------------------------- auth row CRUD
/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {boolean}
 */
export function isInitialized(db) {
  const row = db.prepare('SELECT 1 FROM auth WHERE id = 1').get();
  return Boolean(row);
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {string|null}
 */
export function getPasswordHash(db) {
  const row = db.prepare('SELECT password_hash FROM auth WHERE id = 1').get();
  return row ? String(row.password_hash) : null;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} passwordHash
 */
export function setPasswordHash(db, passwordHash) {
  db.prepare(
    `INSERT INTO auth (id, password_hash, updated_at)
     VALUES (1, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       password_hash = excluded.password_hash,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(passwordHash);
}

// -------------------------------------------------------------- API tokens
/**
 * @param {string} raw
 * @returns {string}
 */
export function hashApiToken(raw) {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * @returns {string} 256bit のランダムトークン (base64url)
 */
export function generateApiToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} name
 * @returns {{id: number, name: string, token: string}}  生 token は 1 度だけ呼び出し元に渡す
 */
export function createApiToken(db, name) {
  const cleanName = (name || '').trim().slice(0, 64) || 'unnamed';
  const raw = generateApiToken();
  const hash = hashApiToken(raw);
  const result = db
    .prepare('INSERT INTO api_tokens (name, token_hash) VALUES (?, ?)')
    .run(cleanName, hash);
  return { id: Number(result.lastInsertRowid), name: cleanName, token: raw };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Array<{id: number, name: string, created_at: string, last_used_at: string|null}>}
 */
export function listApiTokens(db) {
  return db
    .prepare(
      'SELECT id, name, created_at, last_used_at FROM api_tokens ORDER BY id DESC',
    )
    .all();
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} id
 * @returns {boolean}
 */
export function deleteApiToken(db, id) {
  const result = db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} raw  Authorization Bearer の値
 * @returns {boolean}
 */
export function verifyApiToken(db, raw) {
  if (!raw || typeof raw !== 'string' || raw.length < 16) return false;
  const hash = hashApiToken(raw);
  const row = db.prepare('SELECT id FROM api_tokens WHERE token_hash = ?').get(hash);
  if (!row) return false;
  // last_used_at を更新 (ベストエフォート)
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    row.id,
  );
  return true;
}
