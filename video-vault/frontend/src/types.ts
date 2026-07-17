export interface Video {
  id: number;
  url: string;
  site: string;
  title: string;
  thumbnail_url: string | null;
  duration: string | null;
  added_at: string;
  view_count: number;
  last_viewed_at: string | null;
  rating: number | null;
  note: string | null;
  tags: string[];
  deleted_at?: string | null;
}

export interface Tag {
  id: number;
  name: string;
  count: number;
}

export interface HistoryEntry {
  id: number;
  video_id: number;
  viewed_at: string;
  title: string;
  url: string;
  site: string;
  thumbnail_url: string | null;
}

export type SortKey = 'added_at' | 'view_count' | 'last_viewed_at';

export interface VideoFilters {
  q?: string;
  sort?: SortKey;
  tag?: string;
  /** 完全一致 (frontend デフォルト) */
  ratingExact?: number;
  /** これ以上 (任意・互換維持) */
  ratingMin?: number;
  unratedOnly?: boolean;
}
