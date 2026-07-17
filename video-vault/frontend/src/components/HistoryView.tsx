import { useEffect, useState } from 'react';
import type { HistoryEntry } from '../types';
import { clearHistory, fetchHistory, recordView } from '../lib/api';

type DayWindow = 7 | 30 | 0; // 0 = 全期間

export function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [days, setDays] = useState<DayWindow>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory({
        limit: 100,
        sinceDays: days === 0 ? undefined : days,
      });
      setEntries(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const handleClear = async () => {
    if (!confirm('視聴履歴を全削除しますか？（動画自体は消えません）')) return;
    try {
      await clearHistory();
      setEntries([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpen = async (e: HistoryEntry) => {
    window.open(e.url, '_blank', 'noopener,noreferrer');
    await recordView(e.video_id); // 履歴ページから開いても 1 件加算
    void load();
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 text-xs">
          {([7, 30, 0] as DayWindow[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded transition-colors ${
                days === d
                  ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {d === 0 ? '全期間' : `直近${d}日`}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
        >
          履歴クリア
        </button>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200 text-xs p-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中…</p>
      ) : entries.length === 0 ? (
        <p className="text-zinc-500 text-sm py-8 text-center">この期間の履歴はありません。</p>
      ) : (
        <ol className="space-y-1">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => handleOpen(e)}
                className="w-full text-left flex items-center gap-3 p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              >
                <span className="font-mono text-[10px] text-zinc-500 w-32 shrink-0">
                  {formatHistoryDate(e.viewed_at)}
                </span>
                {e.thumbnail_url ? (
                  <img
                    src={e.thumbnail_url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="w-16 aspect-video object-cover rounded shrink-0 border border-zinc-200 dark:border-zinc-800"
                    onError={(ev) => {
                      (ev.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span className="w-16 aspect-video rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-1">{e.title}</p>
                  <p className="text-[11px] text-zinc-500">{e.site}</p>
                </div>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function formatHistoryDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
