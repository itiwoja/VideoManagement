// popup.js — ツールバーアイコンを押した時に出るポップアップ。

const DEFAULT_API = 'http://127.0.0.1:3001';

async function getApiBase() {
  const stored = await chrome.storage.sync.get({ apiBase: DEFAULT_API });
  return (stored.apiBase || DEFAULT_API).replace(/\/$/, '');
}

const urlEl = document.getElementById('current-url');
const saveBtn = document.getElementById('save-btn');
const openVaultBtn = document.getElementById('open-vault');
const optionsLink = document.getElementById('open-options');
const statusEl = document.getElementById('status');

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    urlEl.textContent = '(タブが見つかりません)';
    saveBtn.disabled = true;
    return;
  }
  urlEl.textContent = tab.url;
  if (/^(chrome|about|edge|chrome-extension):/i.test(tab.url)) {
    saveBtn.disabled = true;
    setStatus('内部ページは保存できません', 'error');
  }
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  setStatus('保存中…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'vv:save-current' });
    if (response && response.ok) {
      setStatus('Vault に送信しました（通知を確認）', 'ok');
    } else {
      setStatus('応答エラー', 'error');
    }
  } catch (e) {
    setStatus(`送信失敗: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    setTimeout(() => window.close(), 1200);
  }
});

openVaultBtn.addEventListener('click', async () => {
  const base = await getApiBase();
  // Vault のフロントエンドは同じマシンの 5173 を想定
  const frontendUrl = base.replace(/:\d+$/, ':5173');
  await chrome.tabs.create({ url: frontendUrl });
  window.close();
});

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
