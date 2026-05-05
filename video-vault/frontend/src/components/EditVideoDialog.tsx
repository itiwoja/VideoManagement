import { useEffect, useState } from 'react';
import type { Video } from '../types';
import { attachTag, detachTag, fetchTags, patchVideo } from '../lib/api';
import { StarRating } from './StarRating';

interface EditVideoDialogProps {
  video: Video;
  /** 編集後の最新 video。null は変更なし。 */
  onClose: (updated: Video | null) => void;
}

export function EditVideoDialog({ video: initial, onClose }: EditVideoDialogProps) {
  const [video, setVideo] = useState<Video>(initial);
  const [tagInput, setTagInput] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allTagNames, setAllTagNames] = useState<string[]>([]);

  useEffect(() => {
    fetchTags()
      .then((tags) => setAllTagNames(tags.map((t) => t.name)))
      .catch(() => setAllTagNames([]));
  }, []);

  // ESC で閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(video);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, video]);

  const saveTitle = async (next: string) => {
    if (next === video.title) return;
    setSavingField('title');
    setError(null);
    try {
      const updated = await patchVideo(video.id, { title: next });
      setVideo(updated);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setSavingField(null);
    }
  };

  const saveRating = async (next: number | null) => {
    setSavingField('rating');
    setError(null);
    try {
      const updated = await patchVideo(video.id, { rating: next });
      setVideo(updated);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setSavingField(null);
    }
  };

  const saveNote = async (next: string) => {
    if (next === (video.note ?? '')) return;
    setSavingField('note');
    setError(null);
    try {
      const updated = await patchVideo(video.id, { note: next.length > 0 ? next : null });
      setVideo(updated);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setSavingField(null);
    }
  };

  const addTag = async () => {
    const name = tagInput.trim();
    if (name.length === 0) return;
    setSavingField('tag-add');
    setError(null);
    try {
      await attachTag(video.id, name);
      // re-fetch tags from server is overkill; just append client-side after dedupe
      const next = video.tags.includes(name)
        ? video
        : { ...video, tags: [...video.tags, name].sort() };
      setVideo(next);
      setTagInput('');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setSavingField(null);
    }
  };

  const removeTag = async (name: string) => {
    setSavingField('tag-remove');
    setError(null);
    try {
      // need tagId; fetch list to find id
      const all = await fetchTags();
      const found = all.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (!found) return;
      await detachTag(video.id, found.id);
      setVideo({ ...video, tags: video.tags.filter((t) => t !== name) });
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setSavingField(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      onClick={() => onClose(video)}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">編集</h2>
          <button
            type="button"
            className="text-zinc-500 hover:text-zinc-100"
            onClick={() => onClose(video)}
            aria-label="閉じる"
          >
            ✕
          </button>
        </header>

        {error && (
          <div className="rounded bg-red-950/40 border border-red-900 text-red-200 text-xs p-2">
            {error}
          </div>
        )}

        <Field label="タイトル">
          <textarea
            defaultValue={video.title}
            rows={2}
            onBlur={(e) => saveTitle(e.target.value.trim())}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm
                       focus:outline-none focus:border-zinc-600 resize-none"
          />
          {savingField === 'title' && <Saving />}
        </Field>

        <Field label="評価">
          <StarRating value={video.rating} onChange={saveRating} size="md" />
          {savingField === 'rating' && <Saving />}
        </Field>

        <Field label="メモ">
          <textarea
            defaultValue={video.note ?? ''}
            rows={3}
            placeholder="この動画のメモ（任意）"
            onBlur={(e) => saveNote(e.target.value.trim())}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm
                       focus:outline-none focus:border-zinc-600 resize-none"
          />
          {savingField === 'note' && <Saving />}
        </Field>

        <Field label="タグ">
          {video.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {video.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-200"
                >
                  #{t}
                  <button
                    type="button"
                    aria-label={`${t} を削除`}
                    onClick={() => removeTag(t)}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 mb-2">タグなし</p>
          )}
          <div className="flex gap-2">
            <input
              list="all-tag-names"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="タグを追加（Enterで確定）"
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 text-sm
                         focus:outline-none focus:border-zinc-600"
            />
            <datalist id="all-tag-names">
              {allTagNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={addTag}
              disabled={tagInput.trim().length === 0}
              className="px-3 py-1.5 rounded-md bg-zinc-100 text-zinc-900 text-sm hover:bg-zinc-300
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              追加
            </button>
          </div>
          {savingField?.startsWith('tag-') && <Saving />}
        </Field>

        <footer className="pt-2">
          <button
            type="button"
            onClick={() => onClose(video)}
            className="w-full py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm"
          >
            閉じる
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function Saving() {
  return <p className="mt-1 text-[10px] text-zinc-500">保存中…</p>;
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
