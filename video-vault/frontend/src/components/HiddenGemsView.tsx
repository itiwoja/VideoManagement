import { useEffect, useState } from 'react';
import type { Video } from '../types';
import { deleteVideo, fetchHiddenGems, recordView } from '../lib/api';
import { VideoCard } from './VideoCard';
import { EditVideoDialog } from './EditVideoDialog';
import { VideoPlayer } from './VideoPlayer';

export function HiddenGemsView() {
  const [unwatched, setUnwatched] = useState<Video[]>([]);
  const [neglectedFavorites, setNeglectedFavorites] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Video | null>(null);
  const [playing, setPlaying] = useState<Video | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const gems = await fetchHiddenGems();
      setUnwatched(gems.unwatched);
      setNeglectedFavorites(gems.neglectedFavorites);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const removeFromBothLists = (id: number) => {
    setUnwatched((prev) => prev.filter((v) => v.id !== id));
    setNeglectedFavorites((prev) => prev.filter((v) => v.id !== id));
  };

  const patchInBothLists = (updated: Video) => {
    setUnwatched((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    setNeglectedFavorites((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
  };

  const handleOpen = async (v: Video) => {
    setPlaying(v);
    const updated = await recordView(v.id);
    // 視聴した瞬間に「未視聴」「見返していない」の条件から外れるので一覧からも消す
    if (updated) removeFromBothLists(v.id);
  };

  const handleDelete = async (v: Video) => {
    if (!confirm(`ゴミ箱に移動しますか?\n${v.title}`)) return;
    const ok = await deleteVideo(v.id);
    if (ok) removeFromBothLists(v.id);
  };

  const handleEditClose = (updated: Video | null) => {
    if (updated) patchInBothLists(updated);
    setEditing(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-8">
      <p className="text-xs text-zinc-500">
        保存したまま一度も見ていない動画と、高評価なのに30日以上見返していない動画をここで再発見できます。
      </p>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-200 text-xs p-2">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">読み込み中…</p>
      ) : (
        <>
          <GemSection
            title={`未視聴 (${unwatched.length})`}
            videos={unwatched}
            emptyMessage="未視聴の動画はありません。"
            onOpen={handleOpen}
            onDelete={handleDelete}
            onEdit={setEditing}
          />
          <GemSection
            title={`見返していない高評価 (${neglectedFavorites.length})`}
            videos={neglectedFavorites}
            emptyMessage="見返していない高評価の動画はありません。"
            onOpen={handleOpen}
            onDelete={handleDelete}
            onEdit={setEditing}
          />
        </>
      )}

      {editing && <EditVideoDialog video={editing} onClose={handleEditClose} />}
      {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

interface GemSectionProps {
  title: string;
  videos: Video[];
  emptyMessage: string;
  onOpen: (v: Video) => void;
  onDelete: (v: Video) => void;
  onEdit: (v: Video) => void;
}

function GemSection({ title, videos, emptyMessage, onOpen, onDelete, onEdit }: GemSectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</h2>
      {videos.length === 0 ? (
        <p className="text-zinc-500 text-sm py-4">{emptyMessage}</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map((v) => (
            <VideoCard
              key={v.id}
              video={v}
              onOpen={() => onOpen(v)}
              onDelete={() => onDelete(v)}
              onEdit={() => onEdit(v)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
