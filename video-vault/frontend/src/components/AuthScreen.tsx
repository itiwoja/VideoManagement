import { useState } from 'react';
import { login, setupPassword } from '../lib/auth';

interface AuthScreenProps {
  /** 初回セットアップ画面 (true) かログイン画面 (false) か */
  isSetup: boolean;
  onSuccess: () => void;
}

export function AuthScreen({ isSetup, onSuccess }: AuthScreenProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isSetup) {
      if (password.length < 8) {
        setError('8 文字以上のパスワードを設定してください');
        return;
      }
      if (password !== confirm) {
        setError('確認パスワードが一致しません');
        return;
      }
    }

    setBusy(true);
    try {
      if (isSetup) {
        await setupPassword(password);
      } else {
        await login(password);
      }
      onSuccess();
    } catch (e) {
      // ログイン失敗のメッセージはサーバー応答そのまま (uniform "unauthorized")
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === 'unauthorized' ? 'パスワードが違います' : msg);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 text-zinc-100">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-6 space-y-4"
      >
        <h1 className="text-lg font-semibold tracking-tight">
          {isSetup ? '初回パスワードを設定' : 'パスワードを入力'}
        </h1>

        {isSetup && (
          <p className="text-xs text-zinc-500 leading-relaxed">
            この Vault を使う前にパスワードを設定する必要があります。
            <br />
            8 文字以上で、後で変更できます。
          </p>
        )}

        <div>
          <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
            パスワード
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
            minLength={isSetup ? 8 : 1}
            maxLength={128}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm
                       focus:outline-none focus:border-zinc-600"
            autoComplete={isSetup ? 'new-password' : 'current-password'}
          />
        </div>

        {isSetup && (
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
              パスワード (確認)
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              maxLength={128}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm
                         focus:outline-none focus:border-zinc-600"
              autoComplete="new-password"
            />
          </div>
        )}

        {error && (
          <div className="rounded bg-red-950/40 border border-red-900 text-red-200 text-xs p-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || password.length < 1}
          className="w-full py-2 rounded-md bg-zinc-100 text-zinc-900 text-sm font-medium
                     hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? '送信中…' : isSetup ? '設定する' : 'ログイン'}
        </button>

        {!isSetup && (
          <p className="text-[10px] text-zinc-500 text-center">
            5 回連続で失敗すると 60 秒ロックされます
          </p>
        )}
      </form>
    </div>
  );
}
