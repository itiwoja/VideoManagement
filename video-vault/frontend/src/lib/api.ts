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

export async function fetchVideos(filters: VideoFilters = {}): Promise<Video[]> {
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

  const data = await getJson<{ videos: Video[] }>(`/api/videos?${params}`);
  return data.videos;
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

export async function deleteVideo(id: number): Promise<boolean> {
  const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
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

export type ExtractResult =
  | { kind: 'ok'; media: ExtractedMedia }
  /** 元サイト側で動画が削除済み (HTTP 410)。サーバ側で該当レコードも削除済み。 */
  | { kind: 'gone'; deletedIds: number[] }
  /** 一時的な失敗 (ネットワーク・抽出パーサ不一致など)。レコードは残る。 */
  | { kind: 'failed' };

/**
 * 任意 URL から再生可能な動画 URL を抽出する。
 * サーバが 410 + `error: 'source_gone'` を返したら、元サイトで削除されたことが
 * 確定しているので呼び出し側で UI から該当エントリを除外する。
 */
export async function extractMedia(pageUrl: string): Promise<ExtractResult> {
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl }),
    });
    // 410 = SourceGoneError (元サイトから削除されたことが確定)
    if (res.status === 410) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string; deleted_ids?: number[] }
        | null;
      return { kind: 'gone', deletedIds: body?.deleted_ids ?? [] };
    }
    if (!res.ok) return { kind: 'failed' };
    const data = (await res.json()) as Api<ExtractedMedia>;
    if (!data.ok) return { kind: 'failed' };
    return { kind: 'ok', media: data.data };
  } catch {
    return { kind: 'failed' };
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

export async function clearHistory(opts: { before?: string } = {}): Promise<number> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  const data = await jsonRequest<Api<{ deleted: number }>>(
    `/api/history?${params}`,
    { method: 'DELETE' },
  );
  return unwrap(data).deleted;
}
