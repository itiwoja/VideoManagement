// lib/db.js
// SQLite 接続 + idempotent マイグレーション。
//
// 設計:
//   - PRAGMA user_version で「現在のスキーマバージョン」を持つ
//   - migrations/NNN_xxx.sql を順に実行
//   - ALTER TABLE のような非冪等な操作は SQL ファイルではなく migrate.js 側で実施
//
// Node.js 22.5+ の node:sqlite を使用。

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/**
 * @param {string} [dbPath]  省略時は backend/data.db。':memory:' を渡すとインメモリ DB になる
 *                           (テスト用、#13)。in-memory は WAL 非対応なので journal_mode を分岐する。
 * @returns {DatabaseSync}
 */
export function openDb(dbPath) {
  const resolved = dbPath || path.join(ROOT, 'data.db');
  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`PRAGMA journal_mode = ${resolved === ':memory:' ? 'MEMORY' : 'WAL'};`);
  return db;
}

/**
 * @param {DatabaseSync} db
 * @returns {number}
 */
function userVersion(db) {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row.user_version || 0);
}

/**
 * @param {DatabaseSync} db
 * @param {number} v
 */
function setUserVersion(db, v) {
  db.exec(`PRAGMA user_version = ${Math.floor(v)};`);
}

/**
 * @param {DatabaseSync} db
 * @param {string} table
 * @param {string} column
 * @returns {boolean}
 */
function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

/**
 * Apply pending migrations.
 * @param {DatabaseSync} db
 */
export function migrate(db) {
  const dir = path.join(ROOT, 'migrations');
  const current = userVersion(db);

  // ---- v1: initial schema --------------------------------------------------
  if (current < 1) {
    const sql = fs.readFileSync(path.join(dir, '001_init.sql'), 'utf8');
    db.exec(sql);
    setUserVersion(db, 1);
  }

  // ---- v2: phase 2 (tags / history / rating / note) ------------------------
  if (current < 2) {
    if (!columnExists(db, 'videos', 'rating')) {
      db.exec('ALTER TABLE videos ADD COLUMN rating INTEGER;');
    }
    if (!columnExists(db, 'videos', 'note')) {
      db.exec('ALTER TABLE videos ADD COLUMN note TEXT;');
    }
    const sql = fs.readFileSync(path.join(dir, '002_phase2.sql'), 'utf8');
    db.exec(sql);
    setUserVersion(db, 2);
  }

  // ---- v3: phase 3 (password auth + API tokens) ----------------------------
  if (current < 3) {
    const sql = fs.readFileSync(path.join(dir, '003_auth.sql'), 'utf8');
    db.exec(sql);
    setUserVersion(db, 3);
  }

  // ---- v4: trash (soft delete) ----------------------------------------------
  if (current < 4) {
    if (!columnExists(db, 'videos', 'deleted_at')) {
      db.exec('ALTER TABLE videos ADD COLUMN deleted_at TEXT;');
    }
    setUserVersion(db, 4);
  }

  // ---- v5: link rot detection (#8) ------------------------------------------
  if (current < 5) {
    if (!columnExists(db, 'videos', 'link_status')) {
      db.exec('ALTER TABLE videos ADD COLUMN link_status TEXT;'); // null | 'ok' | 'broken' | 'unknown'
    }
    if (!columnExists(db, 'videos', 'link_checked_at')) {
      db.exec('ALTER TABLE videos ADD COLUMN link_checked_at TEXT;');
    }
    setUserVersion(db, 5);
  }
}
