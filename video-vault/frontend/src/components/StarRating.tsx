interface StarRatingProps {
  value: number | null;
  /** クリックで rating を変える時。null は未評価に戻す */
  onChange?: (next: number | null) => void;
  /** 表示専用 */
  readOnly?: boolean;
  size?: 'sm' | 'md';
}

const SIZE_CLASS: Record<'sm' | 'md', string> = {
  sm: 'text-sm',
  md: 'text-lg',
};

export function StarRating({ value, onChange, readOnly, size = 'sm' }: StarRatingProps) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className={`inline-flex items-center gap-0.5 ${SIZE_CLASS[size]}`}>
      {stars.map((s) => {
        const filled = value !== null && s <= value;
        const baseClass = filled ? 'text-amber-400' : 'text-zinc-700';
        if (readOnly || !onChange) {
          return (
            <span key={s} className={baseClass} aria-hidden="true">
              {filled ? '★' : '☆'}
            </span>
          );
        }
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(value === s ? null : s)}
            className={`${baseClass} hover:text-amber-300 transition-colors`}
            aria-label={`${s} 星`}
          >
            {filled ? '★' : '☆'}
          </button>
        );
      })}
    </div>
  );
}
