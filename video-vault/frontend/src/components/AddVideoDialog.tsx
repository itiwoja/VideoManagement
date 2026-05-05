import { useEffect, useRef, useState } from 'react';
import type { Video } from '../types';
import { createVideo } from '../lib/api';

interface AddVideoDialogProps {
  /** 登録成功 (新規 / 重複どちらも) で呼ばれる。null は「閉じるだけ」 */
  onClose: (created: Video | null) => void;
}

interface SubmitState {
  loading: boolean;
  error: string | null;
}

/**
 * URL を貼り付けて手動で動画を登録するダイアログ。
 * title 省略時は server が og:title を取りに行って補完する。
 */
export function AddVideoDialog({ onClose }: AddVideoDialogProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [state, setState] = useState<SubmitState>({ loading: false, error: null });
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handlePasteFromClipboard = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // clipboard 権限が無いケースは無視 (手で貼ってもらう)
    }
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setState({ loading: false, error: 'URL を入力してください' });
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setState({ loading: false, error: 'URL の形式が正しくありません' });
      return;
    }
    setState({ loading: true, error: null });
    try {
      const result = await createVideo(trimmed, title.trim() || undefined);
      onClose(result.video);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      setState({ loading: false, error: `登録に失敗しました: ${msg}` });
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => onClose(null)}
    >
      <div
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-base font-medium text-zinc-100">動画を追加</h2>
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => onClose(null)}
            className="text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800"
          >
            ×
          </button>
        </header>

        <form onSubmit={(e) => void handleSubmit(e)} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5" htmlFor="add-url">
              URL <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                id="add-url"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                disabled={state.loading}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100
                           focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600
                           disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void handlePasteFromClipboard()}
                disabled={state.loading}
                className="px-3 py-2 text-xs rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-50"
                title="クリップボードから貼り付け"
              >
                📋 貼付
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-500 leading-relaxed">
              タイトル・サムネは自動で取得されます (og:title / og:image)
            </p>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5" htmlFor="add-title">
              タイトル <span className="text-zinc-600">(任意 — 自動取得を上書き)</span>
            </label>
            <input
              id="add-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="自動取得に任せるなら空欄でOK"
              disabled={state.loading}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100
                         focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600
                         disabled:opacity-50"
            />
          </div>

          {state.error && (
            <div className="p-2.5 rounded-md bg-red-950/40 border border-red-900 text-red-200 text-xs">
              {state.error}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => onClose(null)}
              disabled={state.loading}
              className="px-4 py-2 text-sm rounded-md text-zinc-400 hover:text-zinc-100 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={state.loading || !url.trim()}
              className="px-4 py-2 text-sm rounded-md bg-zinc-100 text-zinc-900 font-medium
                         hover:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {state.loading ? '登録中…' : '登録'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
