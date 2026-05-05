import type { Tag } from '../types';

interface TagFilterBarProps {
  tags: Tag[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
  ratingFilter: 'all' | 'unrated' | 3 | 4 | 5;
  onRatingChange: (next: 'all' | 'unrated' | 3 | 4 | 5) => void;
}

const RATING_BUTTONS: Array<{ key: 'all' | 'unrated' | 3 | 4 | 5; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'unrated', label: '未評価' },
  { key: 3, label: '★3+' },
  { key: 4, label: '★4+' },
  { key: 5, label: '★5' },
];

export function TagFilterBar({
  tags,
  activeTag,
  onTagChange,
  ratingFilter,
  onRatingChange,
}: TagFilterBarProps) {
  if (tags.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-6 pb-3 flex flex-wrap items-center gap-3 text-xs">
        <RatingButtons value={ratingFilter} onChange={onRatingChange} />
      </div>
    );
  }
  return (
    <div className="max-w-7xl mx-auto px-6 pb-3 space-y-2">
      <RatingButtons value={ratingFilter} onChange={onRatingChange} />
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => onTagChange(null)}
          className={`px-2 py-0.5 rounded transition-colors ${
            activeTag === null
              ? 'bg-zinc-100 text-zinc-900'
              : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-100'
          }`}
        >
          ALL
        </button>
        {tags.map((t) => {
          const active = activeTag === t.name;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTagChange(active ? null : t.name)}
              className={`px-2 py-0.5 rounded transition-colors ${
                active
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-100'
              }`}
            >
              #{t.name}
              <span className="ml-1 opacity-60">{t.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RatingButtons({
  value,
  onChange,
}: {
  value: 'all' | 'unrated' | 3 | 4 | 5;
  onChange: (next: 'all' | 'unrated' | 3 | 4 | 5) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      {RATING_BUTTONS.map(({ key, label }) => {
        const active = value === key;
        return (
          <button
            key={String(key)}
            type="button"
            onClick={() => onChange(key)}
            className={`px-2 py-0.5 rounded transition-colors ${
              active
                ? 'bg-amber-400 text-zinc-900'
                : 'bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-zinc-100'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
