import { useEffect, useState } from 'react';
import type { Video } from '../types';
import { fetchTrash, purgeVideo, restoreVideo } from '../lib/api';

export function TrashView() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setVideos(await fetchTrash());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleRestore = async (v: Video) => {
    const restored = await restoreVideo(v.id);
    if (restored) setVideos((prev) => prev.filter((x) => x.id !== v.id));
  };

  const handlePurge = async (v: Video) => {
    if (!confirm(`完全に削除しますか？元に戻せません。\n${v.title}`)) return;
    const ok = await purgeVideo(v.id);
    if (ok) setVideos((prev) => prev.filter((x) => x.id !== v.id));
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
      <p className="text-xs text-zinc-500">
        削除した動画は30日間ここに残ります。期限が来ると自動的に完全削除されます。
      </p>

      {error && (
        <div className="rounded bg-red-950/40 border border-red-900 text-red-200 text-xs p-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中…</p>
      ) : videos.length === 0 ? (
        <p className="text-zinc-500 text-sm py-8 text-center">ゴミ箱は空です。</p>
      ) : (
        <ul className="space-y-1">
          {videos.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-3 p-2 rounded-md border border-zinc-800 bg-zinc-900/50"
            >
              {v.thumbnail_url ? (
                <img
                  src={v.thumbnail_url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-16 aspect-video object-cover rounded shrink-0 border border-zinc-800 opacity-60"
                  onError={(ev) => {
                    (ev.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <span className="w-16 aspect-video rounded bg-zinc-900 border border-zinc-800 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-300 line-clamp-1">{v.title}</p>
                <p className="text-[11px] text-zinc-500">
                  {v.site} ・ 削除日 {formatDate(v.deleted_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRestore(v)}
                className="shrink-0 text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
              >
                復元
              </button>
              <button
                type="button"
                onClick={() => handlePurge(v)}
                className="shrink-0 text-xs px-2.5 py-1 rounded bg-red-950 hover:bg-red-900 text-red-200 transition-colors"
              >
                完全に削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
