// options.js — extension の設定ページ。
// 今は backend URL だけ。

const DEFAULT_API = 'http://127.0.0.1:3001';

const apiBaseEl = document.getElementById('api-base');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const statusEl = document.getElementById('status');

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

async function load() {
  const stored = await chrome.storage.sync.get({ apiBase: DEFAULT_API });
  apiBaseEl.value = stored.apiBase || DEFAULT_API;
}

saveBtn.addEventListener('click', async () => {
  const value = (apiBaseEl.value || '').trim().replace(/\/$/, '') || DEFAULT_API;
  await chrome.storage.sync.set({ apiBase: value });
  setStatus('保存しました', 'ok');
  setTimeout(() => setStatus(''), 2000);
});

testBtn.addEventListener('click', async () => {
  const base = (apiBaseEl.value || '').trim().replace(/\/$/, '') || DEFAULT_API;
  setStatus('接続中…');
  try {
    const res = await fetch(`${base}/api/health`);
    if (!res.ok) {
      setStatus(`HTTP ${res.status}`, 'error');
      return;
    }
    const data = await res.json();
    if (data && data.ok) {
      setStatus('OK: backend 応答確認', 'ok');
    } else {
      setStatus('応答が想定外', 'error');
    }
  } catch (e) {
    setStatus(`接続失敗: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
});

load();
