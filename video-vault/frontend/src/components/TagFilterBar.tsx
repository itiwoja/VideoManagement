import type { Tag } from '../types';

export type RatingFilter = 'all' | 'unrated' | 1 | 2 | 3 | 4 | 5;

interface TagFilterBarProps {
  tags: Tag[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
  ratingFilter: RatingFilter;
  onRatingChange: (next: RatingFilter) => void;
  brokenOnly: boolean;
  onBrokenOnlyChange: (next: boolean) => void;
}

const RATING_BUTTONS: ReadonlyArray<{ key: RatingFilter; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'unrated', label: '未評価' },
  { key: 1, label: '★1' },
  { key: 2, label: '★2' },
  { key: 3, label: '★3' },
  { key: 4, label: '★4' },
  { key: 5, label: '★5' },
];

export function TagFilterBar({
  tags,
  activeTag,
  onTagChange,
  ratingFilter,
  onRatingChange,
  brokenOnly,
  onBrokenOnlyChange,
}: TagFilterBarProps) {
  if (tags.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-6 pb-3 flex flex-wrap items-center gap-3 text-xs">
        <RatingButtons value={ratingFilter} onChange={onRatingChange} />
        <BrokenOnlyToggle value={brokenOnly} onChange={onBrokenOnlyChange} />
      </div>
    );
  }
  return (
    <div className="max-w-7xl mx-auto px-6 pb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <RatingButtons value={ratingFilter} onChange={onRatingChange} />
        <BrokenOnlyToggle value={brokenOnly} onChange={onBrokenOnlyChange} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => onTagChange(null)}
          className={`px-2 py-0.5 rounded transition-colors ${
            activeTag === null
              ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
              : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
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
                  ? 'bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
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

interface BrokenOnlyToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
}

function BrokenOnlyToggle({ value, onChange }: BrokenOnlyToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      title="リンク切れの疑いがある動画だけ表示 (#8)"
      className={`px-2 py-0.5 rounded text-xs transition-colors ${
        value
          ? 'bg-red-600 text-white'
          : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
      }`}
    >
      ⚠️ リンク切れのみ
    </button>
  );
}

interface RatingButtonsProps {
  value: RatingFilter;
  onChange: (next: RatingFilter) => void;
}

function RatingButtons({ value, onChange }: RatingButtonsProps) {
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
                : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
