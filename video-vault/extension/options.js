// options.js — extension の設定ページ。
// Backend URL + API トークンを chrome.storage.sync に保存。

const DEFAULT_API = 'http://127.0.0.1:3001';

const apiBaseEl = document.getElementById('api-base');
const apiTokenEl = document.getElementById('api-token');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const statusEl = document.getElementById('status');

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

async function load() {
  const stored = await chrome.storage.sync.get({
    apiBase: DEFAULT_API,
    apiToken: '',
  });
  apiBaseEl.value = stored.apiBase || DEFAULT_API;
  apiTokenEl.value = stored.apiToken || '';
}

saveBtn.addEventListener('click', async () => {
  const base =
    (apiBaseEl.value || '').trim().replace(/\/$/, '') || DEFAULT_API;
  const token = (apiTokenEl.value || '').trim();
  await chrome.storage.sync.set({ apiBase: base, apiToken: token });
  setStatus('保存しました', 'ok');
  setTimeout(() => setStatus(''), 2000);
});

testBtn.addEventListener('click', async () => {
  const base =
    (apiBaseEl.value || '').trim().replace(/\/$/, '') || DEFAULT_API;
  const token = (apiTokenEl.value || '').trim();
  setStatus('接続中…');
  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // health は token 不要
    const res = await fetch(`${base}/api/health`, { headers });
    if (!res.ok) {
      setStatus(`HTTP ${res.status}`, 'error');
      return;
    }
    const data = await res.json();
    if (!data.ok) {
      setStatus('応答が想定外', 'error');
      return;
    }

    if (!token) {
      setStatus('OK (API トークン未設定 - 認証保護されている backend では保存できません)', 'ok');
      return;
    }

    // token 設定時は protected /api/videos を叩いて 200 か確認
    const protectedRes = await fetch(`${base}/api/videos?q=__health_probe`, {
      headers,
    });
    if (protectedRes.status === 200) {
      setStatus('OK: backend と認証どちらも正常', 'ok');
    } else if (protectedRes.status === 401) {
      setStatus('認証失敗: API トークンを確認してください', 'error');
    } else {
      setStatus(`認証チェック HTTP ${protectedRes.status}`, 'error');
    }
  } catch (e) {
    setStatus(`接続失敗: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
});

load();
