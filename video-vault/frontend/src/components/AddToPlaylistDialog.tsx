import { useEffect, useState } from 'react';
import type { Playlist, Video } from '../types';
import { addVideoToPlaylist, createPlaylist, fetchPlaylists } from '../lib/api';

interface AddToPlaylistDialogProps {
  video: Video;
  onClose: () => void;
}

/** 動画をどのプレイリストに入れるか選ぶ軽量ダイアログ (#16)。その場で新規作成もできる。 */
export function AddToPlaylistDialog({ video, onClose }: AddToPlaylistDialogProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);

  useEffect(() => {
    void fetchPlaylists()
      .then(setPlaylists)
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async (playlistId: number) => {
    if (busyId !== null || addedIds.has(playlistId)) return;
    setBusyId(playlistId);
    try {
      await addVideoToPlaylist(playlistId, video.id);
      setAddedIds((prev) => new Set(prev).add(playlistId));
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateAndAdd = async () => {
    const name = newName.trim();
    if (name.length === 0 || busyId !== null) return;
    setBusyId('new');
    try {
      const created = await createPlaylist(name);
      await addVideoToPlaylist(created.id, video.id);
      setPlaylists((prev) => [created, ...prev]);
      setAddedIds((prev) => new Set(prev).add(created.id));
      setNewName('');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1">
            「{video.title}」をプレイリストに追加
          </h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={onClose}
            className="text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
          >
            ×
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateAndAdd();
              }}
              placeholder="新しいプレイリスト名"
              disabled={busyId !== null}
              className="flex-1 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100
                         focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void handleCreateAndAdd()}
              disabled={newName.trim().length === 0 || busyId !== null}
              className="px-3 py-2 text-sm rounded-md bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 font-medium
                         hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              作成
            </button>
          </div>

          {loading ? (
            <p className="text-zinc-500 text-sm">読み込み中…</p>
          ) : playlists.length === 0 ? (
            <p className="text-zinc-500 text-sm py-2">プレイリストがまだありません。上で作成してください。</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto space-y-1">
              {playlists.map((p) => {
                const added = addedIds.has(p.id);
                const busy = busyId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => void handleAdd(p.id)}
                      disabled={added || busy}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                        added
                          ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 cursor-default'
                          : 'bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100 disabled:opacity-50'
                      }`}
                    >
                      <span className="line-clamp-1">{p.name}</span>
                      <span className="text-xs shrink-0 ml-2">
                        {added ? '✓ 追加済み' : `${p.video_count} 件`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
