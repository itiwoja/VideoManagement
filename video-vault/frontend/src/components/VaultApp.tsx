import { useEffect, useMemo, useRef, useState } from 'react';
import type { SortKey, Tag, Video } from '../types';
import { attachTag, deleteVideo, enrichMissingThumbnails, fetchTags, fetchVideos, recordView } from '../lib/api';
import { logout } from '../lib/auth';
import type { Theme } from '../lib/theme';
import { VideoCard } from './VideoCard';
import { AddVideoDialog } from './AddVideoDialog';
import { EditVideoDialog } from './EditVideoDialog';
import { TagFilterBar, type RatingFilter } from './TagFilterBar';
import { HistoryView } from './HistoryView';
import { TrashView } from './TrashView';
import { HiddenGemsView } from './HiddenGemsView';
import { VideoPlayer } from './VideoPlayer';

const SORT_LABEL: Record<SortKey, string> = {
  added_at: '追加日',
  view_count: '視聴回数',
  last_viewed_at: '最終視聴',
};

type Tab = 'vault' | 'history' | 'trash' | 'gems';

const THEME_CYCLE: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' };
const THEME_LABEL: Record<Theme, string> = { light: '☀️ light', dark: '🌙 dark', system: '🖥️ system' };

interface VaultAppProps {
  onLoggedOut: () => void;
  theme: Theme;
  setTheme: (next: Theme) => void;
}

export function VaultApp({ onLoggedOut, theme, setTheme }: VaultAppProps) {
  const [tab, setTab] = useState<Tab>('vault');
  const [videos, setVideos] = useState<Video[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('added_at');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('all');
  const [brokenOnly, setBrokenOnly] = useState(false);
  const [editing, setEditing] = useState<Video | null>(null);
  const [playing, setPlaying] = useState<Video | null>(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // #9: 一括編集
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const filters = {
        q: query || undefined,
        sort,
        tag: activeTag ?? undefined,
        ratingExact: typeof ratingFilter === 'number' ? ratingFilter : undefined,
        unratedOnly: ratingFilter === 'unrated',
        brokenOnly,
      };
      const [v, t] = await Promise.all([fetchVideos(filters), fetchTags()]);
      setVideos(v);
      setAllTags(t);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // 401 ならログアウト扱い (Cookie 期限切れ等)
      if (msg.includes('401')) onLoggedOut();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(load, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, activeTag, ratingFilter, brokenOnly]);

  // 起動時に thumbnail_url が NULL の動画を server 側で og:image 補完する。
  // 補完できたら一覧をリロード。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await enrichMissingThumbnails();
      if (cancelled) return;
      if (result.updated > 0) void load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sites = useMemo(() => {
    const set = new Set(videos.map((v) => v.site));
    return Array.from(set).sort();
  }, [videos]);

  const handleOpen = async (v: Video) => {
    // アプリ内プレイヤーで再生 (対応サイトは iframe 埋め込み、未対応は元サイトボタン)
    setPlaying(v);
    // 視聴回数 +1 + 履歴記録
    const updated = await recordView(v.id);
    if (updated) setVideos((prev) => prev.map((x) => (x.id === v.id ? updated : x)));
  };

  const handleDelete = async (v: Video) => {
    if (!confirm(`ゴミ箱に移動しますか?(30日後に自動で完全削除されます)\n${v.title}`)) return;
    const ok = await deleteVideo(v.id);
    if (ok) setVideos((prev) => prev.filter((x) => x.id !== v.id));
  };

  const handleEditClose = (updated: Video | null) => {
    if (updated) {
      setVideos((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      void fetchTags().then(setAllTags).catch(() => {});
    }
    setEditing(null);
  };

  const handleAddClose = (created: Video | null) => {
    setAdding(false);
    if (created) {
      // 既に同 URL があれば置き換え、無ければ先頭に追加
      setVideos((prev) => {
        const exists = prev.find((x) => x.id === created.id);
        if (exists) return prev.map((x) => (x.id === created.id ? created : x));
        return [created, ...prev];
      });
      void fetchTags().then(setAllTags).catch(() => {});
    }
  };

  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await logout();
    onLoggedOut();
  };

  // #9: 一括編集
  const toggleSelectionMode = () => {
    setSelectionMode((prev) => !prev);
    setSelectedIds(new Set());
    setBulkTagInput('');
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkTag = async () => {
    const name = bulkTagInput.trim();
    if (name.length === 0 || selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      await Promise.all([...selectedIds].map((id) => attachTag(id, name)));
      setBulkTagInput('');
      await load();
      void fetchTags().then(setAllTags).catch(() => {});
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || bulkBusy) return;
    if (!confirm(`選択した ${selectedIds.size} 件をゴミ箱に移動しますか?`)) return;
    setBulkBusy(true);
    try {
      await Promise.all([...selectedIds].map((id) => deleteVideo(id)));
      setVideos((prev) => prev.filter((v) => !selectedIds.has(v.id)));
      setSelectedIds(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="min-h-screen text-zinc-900 dark:text-zinc-100">
      <header className="sticky top-0 z-10 backdrop-blur bg-zinc-50/80 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center gap-4">
          <h1 className="text-xl font-semibold tracking-tight">
            Video Vault
            <span className="ml-2 text-xs font-normal text-zinc-500">{videos.length} 件</span>
          </h1>

          <nav className="flex items-center gap-1 text-sm">
            <TabButton active={tab === 'vault'} onClick={() => setTab('vault')}>
              Vault
            </TabButton>
            <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
              履歴
            </TabButton>
            <TabButton active={tab === 'trash'} onClick={() => setTab('trash')}>
              ゴミ箱
            </TabButton>
            <TabButton active={tab === 'gems'} onClick={() => setTab('gems')}>
              発掘
            </TabButton>
          </nav>

          {tab === 'vault' && (
            <>
              <div className="flex-1 min-w-[200px]">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="タイトル・サイト名で検索"
                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-2 text-sm
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
                        ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                    }`}
                  >
                    {SORT_LABEL[k]}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'vault' && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="px-3 py-1.5 rounded-md bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 text-sm font-medium
                         hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
              title="URL を貼り付けて動画を追加"
            >
              + 追加
            </button>
          )}

          {tab === 'vault' && (
            <button
              type="button"
              onClick={toggleSelectionMode}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                selectionMode
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
              }`}
              title="複数選択してタグ一括付与・一括削除 (#9)"
            >
              {selectionMode ? '選択終了' : '選択'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setTheme(THEME_CYCLE[theme])}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            title="テーマ切替 (light → dark → system)"
          >
            {THEME_LABEL[theme]}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            title="ログアウト"
          >
            🔒 logout
          </button>
        </div>

        {tab === 'vault' && (
          <>
            <TagFilterBar
              tags={allTags}
              activeTag={activeTag}
              onTagChange={setActiveTag}
              ratingFilter={ratingFilter}
              onRatingChange={setRatingFilter}
              brokenOnly={brokenOnly}
              onBrokenOnlyChange={setBrokenOnly}
            />
            {sites.length > 0 && (
              <div className="max-w-7xl mx-auto px-6 pb-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                {sites.map((s) => (
                  <span key={s} className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                    {s}
                  </span>
                ))}
              </div>
            )}
            {selectionMode && (
              <div className="max-w-7xl mx-auto px-6 pb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">{selectedIds.size} 件選択中</span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set(videos.map((v) => v.id)))}
                  className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  すべて選択
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  選択解除
                </button>
                <input
                  type="text"
                  value={bulkTagInput}
                  onChange={(e) => setBulkTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleBulkTag();
                  }}
                  placeholder="タグ名"
                  disabled={selectedIds.size === 0 || bulkBusy}
                  className="w-32 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1
                             focus:outline-none focus:border-zinc-600 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void handleBulkTag()}
                  disabled={selectedIds.size === 0 || bulkTagInput.trim().length === 0 || bulkBusy}
                  className="px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  タグ追加
                </button>
                <button
                  type="button"
                  onClick={() => void handleBulkDelete()}
                  disabled={selectedIds.size === 0 || bulkBusy}
                  className="px-2 py-1 rounded bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ゴミ箱へ
                </button>
              </div>
            )}
          </>
        )}
      </header>

      {tab === 'vault' ? (
        <main className="max-w-7xl mx-auto px-6 py-6">
          {error && (
            <div className="mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200 text-sm">
              読み込み失敗: {error}
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
                  onEdit={() => setEditing(v)}
                  onTagClick={(t) => setActiveTag(t)}
                  selectable={selectionMode}
                  selected={selectedIds.has(v.id)}
                  onToggleSelect={() => toggleSelected(v.id)}
                />
              ))}
            </ul>
          )}
        </main>
      ) : tab === 'history' ? (
        <HistoryView />
      ) : tab === 'trash' ? (
        <TrashView />
      ) : (
        <HiddenGemsView />
      )}

      {adding && <AddVideoDialog onClose={handleAddClose} />}
      {editing && <EditVideoDialog video={editing} onClose={handleEditClose} />}
      {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}

function TabButton({ active, children, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
        active
          ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 text-zinc-500">
      <p className="text-lg mb-2">まだ何もありません</p>
      <p className="text-sm">
        ブックマークレット / Chrome 拡張 / 共有メニュー (PWA) のいずれかから保存できます。
      </p>
    </div>
  );
}
