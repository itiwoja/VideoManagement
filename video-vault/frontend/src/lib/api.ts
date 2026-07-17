import type { HistoryEntry, Tag, Video, VideoFilters } from '../types';

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: string;
}
type Api<T> = ApiOk<T> | ApiErr;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit & { method: string },
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? ` ${text}` : ''}`);
  }
  return (await res.json()) as T;
}

function unwrap<T>(payload: Api<T>): T {
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

export interface VideoPage {
  videos: Video[];
  hasMore: boolean;
}

/** #11: limit/offset によるページネーション。省略時は backend 側の既定 (60件)。 */
export async function fetchVideos(filters: VideoFilters = {}): Promise<VideoPage> {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.tag) params.set('tag', filters.tag);
  if (typeof filters.ratingExact === 'number') {
    params.set('rating', String(filters.ratingExact));
  } else if (typeof filters.ratingMin === 'number') {
    params.set('rating_min', String(filters.ratingMin));
  }
  if (filters.unratedOnly) params.set('unrated', '1');
  if (filters.brokenOnly) params.set('broken', '1');
  if (typeof filters.limit === 'number') params.set('limit', String(filters.limit));
  if (typeof filters.offset === 'number') params.set('offset', String(filters.offset));

  const data = await getJson<{ videos: Video[]; hasMore: boolean }>(`/api/videos?${params}`);
  return { videos: data.videos, hasMore: data.hasMore };
}

export async function recordView(id: number): Promise<Video | null> {
  try {
    const res = await fetch(`/api/videos/${id}/view`, { method: 'POST' });
    if (!res.ok) return null;
    const data = (await res.json()) as { video: Video };
    return data.video;
  } catch {
    return null;
  }
}

export interface CreateVideoResult {
  video: Video;
  created: boolean;
  duplicate?: boolean;
}

/**
 * URL を貼り付けて手動登録する。title/thumbnail はサーバ側で og:* から補完される。
 */
export async function createVideo(url: string, title?: string): Promise<CreateVideoResult> {
  const res = await fetch('/api/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? ` ${text}` : ''}`);
  }
  return (await res.json()) as CreateVideoResult;
}

/** ゴミ箱に移動する(論理削除)。物理削除ではない。 */
export async function deleteVideo(id: number): Promise<boolean> {
  const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
  return res.ok;
}

export async function fetchTrash(): Promise<Video[]> {
  const data = await jsonRequest<Api<{ videos: Video[] }>>('/api/videos/trash', {
    method: 'GET',
  });
  return unwrap(data).videos;
}

export async function restoreVideo(id: number): Promise<Video | null> {
  try {
    const data = await jsonRequest<Api<{ video: Video }>>(`/api/videos/${id}/restore`, {
      method: 'POST',
    });
    return unwrap(data).video;
  } catch {
    return null;
  }
}

/** ゴミ箱からの完全削除。元に戻せない。 */
export async function purgeVideo(id: number): Promise<boolean> {
  const res = await fetch(`/api/videos/${id}/purge`, { method: 'DELETE' });
  return res.ok;
}

export async function patchVideo(
  id: number,
  patch: { title?: string; rating?: number | null; note?: string | null },
): Promise<Video> {
  const data = await jsonRequest<Api<{ video: Video }>>(`/api/videos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return unwrap(data).video;
}

export async function fetchTags(): Promise<Tag[]> {
  const data = await jsonRequest<Api<{ tags: Tag[] }>>('/api/tags', {
    method: 'GET',
  });
  return unwrap(data).tags;
}

export async function attachTag(videoId: number, name: string): Promise<{ id: number; name: string }> {
  const data = await jsonRequest<Api<{ tag: { id: number; name: string } }>>(
    `/api/videos/${videoId}/tags`,
    { method: 'POST', body: JSON.stringify({ name }) },
  );
  return unwrap(data).tag;
}

export async function detachTag(videoId: number, tagId: number): Promise<boolean> {
  try {
    const data = await jsonRequest<Api<{ detached: boolean }>>(
      `/api/videos/${videoId}/tags/${tagId}`,
      { method: 'DELETE' },
    );
    return unwrap(data).detached;
  } catch {
    return false;
  }
}

export async function fetchHistory(opts: {
  limit?: number;
  sinceDays?: number;
} = {}): Promise<HistoryEntry[]> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.sinceDays) params.set('since_days', String(opts.sinceDays));
  const data = await jsonRequest<Api<{ entries: HistoryEntry[] }>>(
    `/api/history?${params}`,
    { method: 'GET' },
  );
  return unwrap(data).entries;
}

export interface ExtractedMedia {
  url: string;
  mediaType: string;
  poster?: string;
  title?: string;
}

/**
 * 任意 URL から再生可能な動画 URL を抽出。失敗時は null。
 */
export async function extractMedia(pageUrl: string): Promise<ExtractedMedia | null> {
  try {
    const data = await jsonRequest<Api<ExtractedMedia>>(`/api/extract`, {
      method: 'POST',
      body: JSON.stringify({ url: pageUrl }),
    });
    return unwrap(data);
  } catch {
    return null;
  }
}

/**
 * NULL の thumbnail を持つ動画を server 側で og:image 補完。
 * 1 リクエスト最大 20 件処理される。
 */
export async function enrichMissingThumbnails(): Promise<{ scanned: number; updated: number }> {
  try {
    const data = await jsonRequest<Api<{ scanned: number; updated: number }>>(
      '/api/videos/enrich-thumbnails',
      { method: 'POST' },
    );
    return unwrap(data);
  } catch {
    return { scanned: 0, updated: 0 };
  }
}

/**
 * 保存済み動画のタイトル・サイト・メモ・既存タグから Claude API でタグ候補を提案してもらう (#14)。
 * 完全 opt-in の機能: backend 側で ANTHROPIC_API_KEY が未設定なら常に [] が返る。
 * 失敗時 (未設定・ネットワークエラー・タイムアウト等) は例外を投げず [] を返す
 * (extractMedia と同じ「ベストエフォート、失敗は無音」のスタイル)。
 */
export async function suggestTags(videoId: number): Promise<string[]> {
  try {
    const data = await jsonRequest<Api<{ tags: string[] }>>(
      `/api/videos/${videoId}/suggest-tags`,
      { method: 'POST' },
    );
    return unwrap(data).tags;
  } catch {
    return [];
  }
}

export interface HiddenGems {
  unwatched: Video[];
  neglectedFavorites: Video[];
}

/** 「埋もれ発掘」: 未視聴の動画 / 高評価なのに見返していない動画 (#21) */
export async function fetchHiddenGems(): Promise<HiddenGems> {
  const data = await jsonRequest<Api<HiddenGems>>('/api/videos/hidden-gems', {
    method: 'GET',
  });
  return unwrap(data);
}

export async function clearHistory(opts: { before?: string } = {}): Promise<number> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  const data = await jsonRequest<Api<{ deleted: number }>>(
    `/api/history?${params}`,
    { method: 'DELETE' },
  );
  return unwrap(data).deleted;
}
