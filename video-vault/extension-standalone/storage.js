// storage.js
// chrome.storage.local を薄くラップして、Video / Tag の永続化を提供する。
// chrome.storage は最大 10MB (unlimitedStorage 取らない場合)、
// 数千件の動画 (URL / メタデータのみ) なら余裕で収まる。

/**
 * @typedef {Object} Video
 * @property {string} id            UUID
 * @property {string} url
 * @property {string} site          ドメイン
 * @property {string} title
 * @property {string|null} thumbnailUrl
 * @property {string} addedAt       ISO datetime
 * @property {number} viewCount
 * @property {string|null} lastViewedAt
 * @property {number|null} rating   0-5 or null
 * @property {string|null} note
 * @property {string[]} tags
 */

const KEY = 'vault_v1';

const EMPTY_DATA = {
  videos: /** @type {Video[]} */ ([]),
  schemaVersion: 1,
};

/** @returns {Promise<{videos: Video[], schemaVersion: number}>} */
async function readAll() {
  const stored = await chrome.storage.local.get(KEY);
  return stored[KEY] ?? structuredClone(EMPTY_DATA);
}

/**
 * @param {{videos: Video[], schemaVersion: number}} data
 */
async function writeAll(data) {
  await chrome.storage.local.set({ [KEY]: data });
}

function uuid() {
  return crypto.randomUUID();
}

function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/** @returns {Promise<Video[]>} */
export async function listVideos() {
  const data = await readAll();
  return [...data.videos].sort(
    (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
  );
}

/**
 * @param {string} url
 * @returns {Promise<Video|null>}
 */
export async function findByUrl(url) {
  const data = await readAll();
  return data.videos.find((v) => v.url === url) ?? null;
}

/**
 * @param {{url: string, title?: string, thumbnailUrl?: string|null}} input
 * @returns {Promise<{video: Video, duplicate: boolean}>}
 */
export async function createVideo(input) {
  const data = await readAll();
  const exists = data.videos.find((v) => v.url === input.url);
  if (exists) return { video: exists, duplicate: true };

  /** @type {Video} */
  const video = {
    id: uuid(),
    url: input.url,
    site: siteOf(input.url),
    title: input.title?.trim() || input.url,
    thumbnailUrl: input.thumbnailUrl ?? null,
    addedAt: new Date().toISOString(),
    viewCount: 0,
    lastViewedAt: null,
    rating: null,
    note: null,
    tags: [],
  };
  data.videos.push(video);
  await writeAll(data);
  return { video, duplicate: false };
}

/**
 * @param {string} id
 * @param {Partial<Pick<Video, 'title' | 'rating' | 'note' | 'tags' | 'thumbnailUrl'>>} patch
 * @returns {Promise<Video|null>}
 */
export async function updateVideo(id, patch) {
  const data = await readAll();
  const idx = data.videos.findIndex((v) => v.id === id);
  if (idx < 0) return null;
  const cur = data.videos[idx];
  /** @type {Video} */
  const next = { ...cur };
  if (typeof patch.title === 'string') next.title = patch.title;
  if (patch.rating === null || typeof patch.rating === 'number') next.rating = patch.rating;
  if (patch.note === null || typeof patch.note === 'string') next.note = patch.note;
  if (Array.isArray(patch.tags)) next.tags = patch.tags;
  if (patch.thumbnailUrl === null || typeof patch.thumbnailUrl === 'string') {
    next.thumbnailUrl = patch.thumbnailUrl;
  }
  data.videos[idx] = next;
  await writeAll(data);
  return next;
}

/**
 * @param {string} id
 * @returns {Promise<Video|null>}
 */
export async function recordView(id) {
  const data = await readAll();
  const idx = data.videos.findIndex((v) => v.id === id);
  if (idx < 0) return null;
  data.videos[idx] = {
    ...data.videos[idx],
    viewCount: data.videos[idx].viewCount + 1,
    lastViewedAt: new Date().toISOString(),
  };
  await writeAll(data);
  return data.videos[idx];
}

/**
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteVideo(id) {
  const data = await readAll();
  const before = data.videos.length;
  data.videos = data.videos.filter((v) => v.id !== id);
  if (data.videos.length === before) return false;
  await writeAll(data);
  return true;
}

/** @returns {Promise<string[]>} */
export async function listAllTags() {
  const videos = await listVideos();
  const set = new Set();
  for (const v of videos) for (const t of v.tags) set.add(t);
  return Array.from(set).sort();
}

/**
 * JSON エクスポート (バックアップ・別端末への移行用)
 * @returns {Promise<string>}
 */
export async function exportJson() {
  const data = await readAll();
  return JSON.stringify(data, null, 2);
}

/**
 * JSON インポート (既存データに追加マージ、URL 重複はスキップ)
 * @param {string} json
 * @returns {Promise<{added: number, skipped: number}>}
 */
export async function importJson(json) {
  const incoming = JSON.parse(json);
  if (!incoming || !Array.isArray(incoming.videos)) {
    throw new Error('invalid backup format');
  }
  const data = await readAll();
  const existingUrls = new Set(data.videos.map((v) => v.url));
  let added = 0;
  let skipped = 0;
  for (const v of incoming.videos) {
    if (!v.url || existingUrls.has(v.url)) {
      skipped++;
      continue;
    }
    data.videos.push({
      id: v.id ?? uuid(),
      url: v.url,
      site: v.site ?? siteOf(v.url),
      title: v.title ?? v.url,
      thumbnailUrl: v.thumbnailUrl ?? v.thumbnail_url ?? null,
      addedAt: v.addedAt ?? v.added_at ?? new Date().toISOString(),
      viewCount: v.viewCount ?? v.view_count ?? 0,
      lastViewedAt: v.lastViewedAt ?? v.last_viewed_at ?? null,
      rating: v.rating ?? null,
      note: v.note ?? null,
      tags: Array.isArray(v.tags) ? v.tags : [],
    });
    added++;
    existingUrls.add(v.url);
  }
  await writeAll(data);
  return { added, skipped };
}
