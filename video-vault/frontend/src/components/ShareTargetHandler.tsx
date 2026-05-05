import { useEffect, useState } from 'react';

interface ShareTargetHandlerProps {
  /** 保存先候補 URL (Web Share Target からの url か text 内 URL) */
  url: string;
  title: string;
  onDone: () => void;
}

/**
 * /share?url=...&title=...&text=... を受けて backend に POST → 完了したら / にリダイレクト。
 * Cookie 認証が前提。未認証で 401 が返ったら親の AuthGate がログイン画面に戻す。
 */
export function ShareTargetHandler({ url, title, onDone }: ShareTargetHandlerProps) {
  const [status, setStatus] = useState<'sending' | 'ok' | 'duplicate' | 'error'>('sending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const finalTitle = title || hostnameFallback(url);
        const res = await fetch('/api/videos', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, title: finalTitle }),
        });
        if (cancelled) return;
        if (res.status === 401) {
          // 親で auth チェックして login 画面に戻すので、ここではメッセージだけ
          setStatus('error');
          setMessage('未ログインです。ログインしてからもう一度共有してください。');
          return;
        }
        if (!res.ok) {
          setStatus('error');
          setMessage(`HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as { duplicate?: boolean; video?: { title?: string } };
        if (data.duplicate) {
          setStatus('duplicate');
          setMessage(data.video?.title ?? finalTitle);
        } else {
          setStatus('ok');
          setMessage(data.video?.title ?? finalTitle);
        }
        // 1.5 秒後にメインに戻る
        setTimeout(onDone, 1500);
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setMessage(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, title, onDone]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 text-zinc-100">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-6 space-y-3">
        <h1 className="text-base font-semibold">
          {status === 'sending' && '保存中…'}
          {status === 'ok' && '✅ Vault に追加'}
          {status === 'duplicate' && 'ℹ️ 既に登録済み'}
          {status === 'error' && '⚠️ 保存失敗'}
        </h1>
        <p className="text-xs text-zinc-400 break-all leading-relaxed">{url}</p>
        {message && <p className="text-xs text-zinc-300">{message}</p>}
        <button
          type="button"
          onClick={onDone}
          className="w-full mt-2 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-sm"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

function hostnameFallback(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Untitled';
  }
}
