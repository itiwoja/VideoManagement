import type { Video } from '../types';
import { StarRating } from './StarRating';

interface VideoCardProps {
  video: Video;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onTagClick?: (tag: string) => void;
  /** #9: 一括編集モード。true の間はクリックで選択トグル、再生は開かない。 */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

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
    minute: '2-digit',
  });
}

export function VideoCard({
  video,
  onOpen,
  onDelete,
  onEdit,
  onTagClick,
  selectable = false,
  selected = false,
  onToggleSelect,
}: VideoCardProps) {
  const dur = formatDuration(video.duration);
  const visibleTags = video.tags.slice(0, 3);
  const moreTagsCount = video.tags.length - visibleTags.length;

  return (
    <li
      className={`group rounded-xl overflow-hidden bg-white dark:bg-zinc-900 border transition-colors ${
        selected
          ? 'border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/40 dark:ring-indigo-400/40'
          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
      }`}
    >
      <button
        onClick={selectable ? onToggleSelect : onOpen}
        className="block w-full text-left"
        title={selectable ? 'クリックで選択' : 'クリックでアプリ内プレイヤーを開く（視聴回数 +1）'}
      >
        <div className="relative aspect-video bg-zinc-200 dark:bg-zinc-800">
          {selectable && (
            <span
              className={`absolute z-10 top-2 left-2 w-5 h-5 rounded border flex items-center justify-center text-xs ${
                selected
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-black/50 border-zinc-400'
              }`}
            >
              {selected ? '✓' : ''}
            </span>
          )}
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
          <span
            className={`absolute top-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] uppercase tracking-wide text-zinc-300 ${
              selectable ? 'left-9' : 'left-2'
            }`}
          >
            {video.site}
          </span>
          {video.link_status === 'broken' && (
            <span
              className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-red-600/90 text-white text-[10px]"
              title="リンク切れの疑いがあります (404 / リンク先消失)"
            >
              ⚠️ リンク切れ
            </span>
          )}
          {video.note && (
            <span
              className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-zinc-200 text-xs"
              title={video.note}
            >
              📝
            </span>
          )}
        </div>
        <div className="p-3 space-y-2">
          <h3 className="text-sm font-medium leading-snug line-clamp-2 text-zinc-900 dark:text-zinc-100">
            {video.title}
          </h3>

          <div className="flex items-center justify-between gap-2">
            <StarRating value={video.rating} readOnly size="sm" />
            <div className="text-xs text-zinc-500">
              👁 {video.view_count} ・ {formatDate(video.last_viewed_at ?? video.added_at)}
            </div>
          </div>
        </div>
      </button>

      {visibleTags.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {visibleTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTagClick?.(t);
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
            >
              #{t}
            </button>
          ))}
          {moreTagsCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 text-zinc-500">+{moreTagsCount}</span>
          )}
        </div>
      )}

      <div className="px-3 pb-3 flex justify-end gap-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          編集
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
        >
          削除
        </button>
      </div>
    </li>
  );
}
