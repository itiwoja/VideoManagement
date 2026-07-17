import { useEffect, useState } from 'react';
import type { Playlist, Video } from '../types';
import {
  createPlaylist,
  deletePlaylist,
  fetchPlaylistDetail,
  fetchPlaylists,
  recordView,
  removeVideoFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
} from '../lib/api';
import { VideoCard } from './VideoCard';
import { EditVideoDialog } from './EditVideoDialog';
import { VideoPlayer } from './VideoPlayer';

export function PlaylistsView() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setPlaylists(await fetchPlaylists());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (name.length === 0) return;
    const created = await createPlaylist(name);
    setPlaylists((prev) => [created, ...prev]);
    setNewName('');
  };

  const handleDelete = async (p: Playlist) => {
    if (!confirm(`プレイリスト「${p.name}」を削除しますか?(中の動画自体は削除されません)`)) return;
    const ok = await deletePlaylist(p.id);
    if (ok) setPlaylists((prev) => prev.filter((x) => x.id !== p.id));
  };

  if (openId !== null) {
    return (
      <PlaylistDetail
        playlistId={openId}
        onBack={() => setOpenId(null)}
        onRenamed={(updated) =>
          setPlaylists((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
        }
      />
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
          placeholder="新しいプレイリスト名"
          className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-3 py-2 text-sm
                     focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={newName.trim().length === 0}
          className="px-4 py-2 text-sm rounded-md bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 font-medium
                     hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          作成
        </button>
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200 text-xs p-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中…</p>
      ) : playlists.length === 0 ? (
        <p className="text-zinc-500 text-sm py-8 text-center">
          プレイリストがまだありません。上で作成するか、動画カードの「📋 追加」からも作れます。
        </p>
      ) : (
        <ul className="space-y-1">
          {playlists.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between p-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
            >
              <button type="button" onClick={() => setOpenId(p.id)} className="flex-1 text-left min-w-0">
                <p className="text-sm text-zinc-900 dark:text-zinc-100 line-clamp-1">{p.name}</p>
                <p className="text-xs text-zinc-500">{p.video_count} 件</p>
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(p)}
                className="shrink-0 text-xs text-zinc-500 hover:text-red-400 transition-colors ml-3"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PlaylistDetailProps {
  playlistId: number;
  onBack: () => void;
  onRenamed: (updated: Playlist) => void;
}

function PlaylistDetail({ playlistId, onBack, onRenamed }: PlaylistDetailProps) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Video | null>(null);
  const [playing, setPlaying] = useState<Video | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchPlaylistDetail(playlistId);
      setPlaylist(detail.playlist);
      setVideos(detail.videos);
      setNameInput(detail.playlist.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  const handleOpen = async (v: Video) => {
    setPlaying(v);
    const updated = await recordView(v.id);
    if (updated) setVideos((prev) => prev.map((x) => (x.id === v.id ? updated : x)));
  };

  const handleRemove = async (v: Video) => {
    const ok = await removeVideoFromPlaylist(playlistId, v.id);
    if (ok) setVideos((prev) => prev.filter((x) => x.id !== v.id));
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= videos.length) return;
    const next = [...videos];
    [next[index], next[target]] = [next[target], next[index]];
    setVideos(next); // 楽観的更新
    try {
      await reorderPlaylist(
        playlistId,
        next.map((v) => v.id),
      );
    } catch {
      void load(); // 失敗したらサーバーの実際の状態に合わせ直す
    }
  };

  const handleRename = async () => {
    const name = nameInput.trim();
    if (name.length === 0 || !playlist) return;
    const updated = await renamePlaylist(playlistId, name);
    setPlaylist(updated);
    onRenamed(updated);
    setRenaming(false);
  };

  const handleEditClose = (updated: Video | null) => {
    if (updated) setVideos((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    setEditing(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          ← 一覧に戻る
        </button>

        {renaming ? (
          <div className="flex gap-2 flex-1">
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename();
              }}
              autoFocus
              className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1 text-sm
                         focus:outline-none focus:border-zinc-600"
            />
            <button
              type="button"
              onClick={() => void handleRename()}
              className="text-sm px-2 py-1 rounded bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
            >
              保存
            </button>
          </div>
        ) : (
          <h2
            onClick={() => setRenaming(true)}
            title="クリックで名前を変更"
            className="text-lg font-medium text-zinc-900 dark:text-zinc-100 cursor-pointer hover:opacity-70"
          >
            {playlist?.name ?? '…'}
          </h2>
        )}
      </div>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200 text-xs p-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中…</p>
      ) : videos.length === 0 ? (
        <p className="text-zinc-500 text-sm py-8 text-center">
          このプレイリストは空です。動画カードの「📋 追加」から追加できます。
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map((v, i) => (
            <VideoCard
              key={v.id}
              video={v}
              onOpen={() => handleOpen(v)}
              onDelete={() => handleRemove(v)}
              onEdit={() => setEditing(v)}
              deleteLabel="外す"
              extraActions={
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void move(i, -1);
                    }}
                    disabled={i === 0}
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 transition-colors"
                    title="上に移動"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void move(i, 1);
                    }}
                    disabled={i === videos.length - 1}
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 transition-colors"
                    title="下に移動"
                  >
                    ↓
                  </button>
                </>
              }
            />
          ))}
        </ul>
      )}

      {editing && <EditVideoDialog video={editing} onClose={handleEditClose} />}
      {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
