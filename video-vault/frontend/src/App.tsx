import { useEffect, useState } from 'react';
import { getAuthState, type AuthState } from './lib/auth';
import { AuthScreen } from './components/AuthScreen';
import { VaultApp } from './components/VaultApp';
import { ShareTargetHandler } from './components/ShareTargetHandler';

interface ShareIntent {
  url: string;
  title: string;
}

/**
 * 共有メニューから来た URL を URLSearchParams から拾う。
 * Web Share Target は params の名前を manifest 側で決めるので、
 * url / text / title の 3 種類を見て一番それっぽい URL を返す。
 */
function readShareIntent(): ShareIntent | null {
  if (window.location.pathname !== '/share') return null;
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get('url');
  const text = params.get('text');
  const title = params.get('title') ?? '';

  const candidate = explicit ?? extractUrlFromText(text);
  if (!candidate) return null;
  return { url: candidate, title };
}

function extractUrlFromText(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [shareIntent, setShareIntent] = useState<ShareIntent | null>(() => readShareIntent());

  const refreshAuth = () => {
    getAuthState()
      .then((s) => {
        setAuth(s);
        setAuthError(null);
      })
      .catch((e) => {
        setAuthError(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-100 px-4">
        <div className="rounded bg-red-950/40 border border-red-900 text-red-200 text-sm p-3 max-w-md">
          backend 接続失敗: {authError}
          <div className="mt-1 text-xs text-red-300/80">
            backend (port 3001) が起動しているか確認してください。
          </div>
        </div>
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="min-h-screen flex items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }

  if (!auth.authenticated) {
    return <AuthScreen isSetup={!auth.initialized} onSuccess={refreshAuth} />;
  }

  // 認証済みかつ /share に来た → 保存処理
  if (shareIntent) {
    return (
      <ShareTargetHandler
        url={shareIntent.url}
        title={shareIntent.title}
        onDone={() => {
          setShareIntent(null);
          window.history.replaceState({}, '', '/');
        }}
      />
    );
  }

  return <VaultApp onLoggedOut={refreshAuth} />;
}
