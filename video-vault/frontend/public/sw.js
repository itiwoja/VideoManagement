// public/sw.js
// PWA Service Worker。
//
// 主役は Web Share Target (POST /share) のハンドリング。
// `manifest.webmanifest` で method=POST にして SW がインターセプトすると、
// メインの Vault 画面を開かずに backend へ保存できる。

self.addEventListener('install', (_event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith(handleShare(event.request));
  }
  // それ以外は素通し
});

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleShare(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return htmlResponse(renderResult('error', 'リクエストを解釈できませんでした'));
  }

  const sharedUrl = pickUrl(formData);
  const title = (formData.get('title') || '').toString();

  if (!sharedUrl) {
    return htmlResponse(renderResult('error', '共有データから URL を抽出できませんでした'));
  }

  const finalTitle = title || hostnameFallback(sharedUrl);

  try {
    const res = await fetch('/api/videos', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sharedUrl, title: finalTitle }),
    });

    if (res.status === 401) {
      // 未認証 → SPA に遷移してログイン画面 → 再共有してもらう
      const target = `/?need_auth=1&pending_url=${encodeURIComponent(sharedUrl)}`;
      return Response.redirect(target, 303);
    }

    if (!res.ok) {
      return htmlResponse(renderResult('error', `保存失敗 HTTP ${res.status}`));
    }

    /** @type {{ duplicate?: boolean, video?: { title?: string } }} */
    const data = await res.json().catch(() => ({}));
    const status = data.duplicate ? 'duplicate' : 'ok';
    const label = data.video?.title || finalTitle;
    return htmlResponse(renderResult(status, label));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return htmlResponse(renderResult('error', msg));
  }
}

/**
 * @param {FormData} fd
 * @returns {string|null}
 */
function pickUrl(fd) {
  const explicit = (fd.get('url') || '').toString().trim();
  if (explicit) return explicit;
  const text = (fd.get('text') || '').toString();
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

/**
 * @param {string} url
 */
function hostnameFallback(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Untitled';
  }
}

/**
 * @param {'ok'|'duplicate'|'error'} status
 * @param {string} message
 */
function renderResult(status, message) {
  // 0.8 秒後に window.close()。閉じれない端末でも視覚フィードバックは残る。
  const titleByStatus = {
    ok: '✅ Vault に追加',
    duplicate: 'ℹ️ 既に登録済み',
    error: '⚠️ 保存失敗',
  };
  const title = titleByStatus[status];
  // XSS 対策: textContent でセットするので sw.js から渡す値はエスケープ不要だが、
  // 念のため `<` `>` をプレースホルダで除く。
  const safeMessage = String(message).replace(/[<>]/g, '');
  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Video Vault</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #18181b;
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        padding: 2rem;
      }
      .card {
        max-width: 320px;
        width: 100%;
        background: #27272a;
        border: 1px solid #3f3f46;
        border-radius: 16px;
        padding: 1.25rem 1.25rem 1rem;
        text-align: center;
      }
      h1 { font-size: 1rem; margin: 0 0 .5rem; }
      p { font-size: .82rem; color: #a1a1aa; margin: 0; word-break: break-all; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${safeMessage}</p>
    </div>
    <script>
      setTimeout(function () {
        try { window.close(); } catch (_) {}
        // window.close が効かない場合のフォールバック
        try { history.back(); } catch (_) {}
      }, 800);
    </script>
  </body>
</html>`;
}

/**
 * @param {string} html
 */
function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
