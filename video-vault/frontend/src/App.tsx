import { useEffect, useMemo, useRef, useState } from 'react';

type Video = {
  id: number;
  url: string;
  site: string;
  title: string;
  thumbnail_url: string | null;
  duration: string | null;
  added_at: string;
  view_count: number;
  last_viewed_at: string | null;
};

type SortKey = 'added_at' | 'view_count' | 'last_viewed_at';

const SORT_LABEL: Record<SortKey, string> = {
  added_at: '追加日',
  view_count: '視聴回数',
  last_viewed_at: '最終視聴'
};

function formatDuration(raw: string | null): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return raw;
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('added_at');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  const load = async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      params.set('sort', sort);
      const res = await fetch(`/api/videos?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVideos(data.videos);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  // Debounced reload on query/sort change
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(load, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort]);

  const sites = useMemo(() => {
    const set = new Set(videos.map((v) => v.site));
    return Array.from(set).sort();
  }, [videos]);

  const handleOpen = async (v: Video) => {
    window.open(v.url, '_blank', 'noopener,noreferrer');
    try {
      const res = await fetch(`/api/videos/${v.id}/view`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setVideos((prev) => prev.map((x) => (x.id === v.id ? data.video : x)));
      }
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async (v: Video) => {
    if (!confirm(`削除しますか?\n${v.title}`)) return;
    const res = await fetch(`/api/videos/${v.id}`, { method: 'DELETE' });
    if (res.ok) setVideos((prev) => prev.filter((x) => x.id !== v.id));
  };

  return (
    <div className="min-h-screen text-zinc-100">
      <header className="sticky top-0 z-10 backdrop-blur bg-zinc-950/80 border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center gap-4">
          <h1 className="text-xl font-semibold tracking-tight">
            Video Vault
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {videos.length} 件
            </span>
          </h1>

          <div className="flex-1 min-w-[200px]">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="タイトル・サイト名で検索"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm
                         focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600"
            />
          </div>

          <div className="flex items-center gap-1 text-sm">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  sort === k
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
                }`}
              >
                {SORT_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        {sites.length > 0 && (
          <div className="max-w-7xl mx-auto px-6 pb-3 flex flex-wrap gap-2 text-xs text-zinc-500">
            {sites.map((s) => (
              <span key={s} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                {s}
              </span>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-950/40 border border-red-900 text-red-200 text-sm">
            読み込み失敗: {error} <br />
            <span className="text-red-300/70">backend が起動しているか確認してください。</span>
          </div>
        )}

        {loading ? (
          <p className="text-zinc-500">読み込み中…</p>
        ) : videos.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                onOpen={() => handleOpen(v)}
                onDelete={() => handleDelete(v)}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function VideoCard({
  video,
  onOpen,
  onDelete
}: {
  video: Video;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const dur = formatDuration(video.duration);
  return (
    <li className="group rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors">
      <button
        onClick={onOpen}
        className="block w-full text-left"
        title="クリックで新規タブで開く（視聴回数 +1）"
      >
        <div className="relative aspect-video bg-zinc-800">
          {video.thumbnail_url ? (
            <img
              src={video.thumbnail_url}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
              no thumbnail
            </div>
          )}
          {dur && (
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-xs font-mono">
              {dur}
            </span>
          )}
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] uppercase tracking-wide text-zinc-300">
            {video.site}
          </span>
        </div>
        <div className="p-3">
          <h3 className="text-sm font-medium leading-snug line-clamp-2 text-zinc-100">
            {video.title}
          </h3>
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>👁 {video.view_count}</span>
            <span>{formatDate(video.last_viewed_at ?? video.added_at)}</span>
          </div>
        </div>
      </button>
      <div className="px-3 pb-3 flex justify-end">
        <button
          onClick={onDelete}
          className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
        >
          削除
        </button>
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 text-zinc-500">
      <p className="text-lg mb-2">まだ何もありません</p>
      <p className="text-sm">
        ブックマークレットを動画ページで実行すると、ここに追加されます。
      </p>
    </div>
  );
}
