// lib/thumbnail-cache.js
// サムネイル画像をローカルにダウンロードして保存する (#7)。
// 「消えないVault」の3本柱の1つ: サムネ URL 自体が失効しても表示が壊れないようにする。
//
// videos.thumbnail_url は最初 og:image などの外部 URL がそのまま入る。
// このモジュールはそれを一度だけダウンロードし、DB の thumbnail_url を
// ローカル配信パス (`/thumbs/<id>.<ext>`) に書き換える。書き換え後は
// findRemoteThumbnails() の対象から外れるので再ダウンロードは走らない。

import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const THUMBS_DIR = path.join(ROOT, 'data', 'thumbnails');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB — サムネ画像として十分すぎる上限

const EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function ensureThumbsDir() {
  if (!existsSync(THUMBS_DIR)) mkdirSync(THUMBS_DIR, { recursive: true });
}

/**
 * @param {string} remoteUrl
 * @param {number} videoId
 * @returns {Promise<string|null>} 成功したらローカル配信 URL パス (`/thumbs/xxx.jpg`)、失敗したら null
 */
export async function downloadThumbnail(remoteUrl, videoId) {
  ensureThumbsDir();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(remoteUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    if (!res.ok || !res.body) return null;

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const ext = EXT_BY_CONTENT_TYPE[contentType] ?? extFromUrl(remoteUrl) ?? 'jpg';

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) return null;

    const filename = `${videoId}.${ext}`;
    const destPath = path.join(THUMBS_DIR, filename);

    try {
      const capped = Readable.from(capBytes(res.body, MAX_BYTES));
      await pipeline(capped, createWriteStream(destPath));
    } catch (err) {
      // サイズ超過等で pipeline が失敗したら中途半端なファイルを残さない
      try {
        if (existsSync(destPath)) unlinkSync(destPath);
      } catch {
        // best effort
      }
      throw err;
    }

    return `/thumbs/${filename}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ReadableStream (Web Streams) を Node の async iterable として消費しつつ、
 * 上限バイト数を超えたら打ち切る。og:image に稀にある巨大画像・詰め込みDoS対策。
 * @param {ReadableStream} webStream
 * @param {number} maxBytes
 */
async function* capBytes(webStream, maxBytes) {
  const reader = webStream.getReader();
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('thumbnail too large');
      }
      yield value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

/**
 * @param {string} url
 * @returns {string|null}
 */
function extFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : null;
  } catch {
    return null;
  }
}

/**
 * 既存のローカルキャッシュファイルを削除する (動画の完全削除時に呼ぶ)。
 * @param {string|null} thumbnailUrl  videos.thumbnail_url の値
 */
export function deleteCachedThumbnail(thumbnailUrl) {
  if (!thumbnailUrl || !thumbnailUrl.startsWith('/thumbs/')) return;
  const filename = thumbnailUrl.replace('/thumbs/', '');
  // パストラバーサル対策: ベース名以外の文字が来たら無視
  if (filename.includes('/') || filename.includes('..')) return;
  const filePath = path.join(THUMBS_DIR, filename);
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // best effort
  }
}
