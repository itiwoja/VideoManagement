// popup.js — popup UI ロジック
// chrome.storage には直接アクセスせず、background に runtime メッセージを投げる。

(async function init() {
  const titleEl = document.getElementById('tab-title');
  const urlEl = document.getElementById('tab-url');
  const saveBtn = document.getElementById('save-btn');
  const resultEl = document.getElementById('result');
  const openVaultBtn = document.getElementById('open-vault');
  const countEl = document.getElementById('count');

  let activeTab = null;

  // 現在のタブ情報を取得
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
    if (activeTab) {
      titleEl.textContent = activeTab.title || '(タイトルなし)';
      urlEl.textContent = activeTab.url || '';
      // 拡張機能ページや chrome:// は保存できない
      if (!activeTab.url || /^(chrome|edge|about|chrome-extension):/.test(activeTab.url)) {
        saveBtn.disabled = true;
        document.getElementById('save-label').textContent = '🚫 このページは保存不可';
      }
    }
  } catch (err) {
    titleEl.textContent = '(タブ情報取得失敗)';
  }

  // 保存件数を表示
  refreshCount();

  // 保存ボタン
  saveBtn.addEventListener('click', async () => {
    if (!activeTab) return;
    saveBtn.disabled = true;
    document.getElementById('save-label').textContent = '保存中…';

    const response = await chrome.runtime.sendMessage({
      type: 'save_url',
      url: activeTab.url,
      title: activeTab.title,
    });

    showResult(response);
    refreshCount();
  });

  // Vault を開くボタン
  openVaultBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'open_vault' });
    window.close();
  });

  function showResult(response) {
    resultEl.classList.remove('hidden', 'error', 'dup');
    if (!response || !response.ok) {
      resultEl.classList.add('error');
      resultEl.textContent = `❌ 保存失敗: ${response?.error ?? '不明なエラー'}`;
      document.getElementById('save-label').textContent = '📥 もう一度試す';
      saveBtn.disabled = false;
      return;
    }
    if (response.duplicate) {
      resultEl.classList.add('dup');
      resultEl.textContent = '⚠️ 既に保存済み';
    } else {
      resultEl.textContent = '✅ Vault に保存しました';
    }
    document.getElementById('save-label').textContent = '✓ 保存完了';
  }

  async function refreshCount() {
    try {
      const stored = await chrome.storage.local.get('vault_v1');
      const data = stored.vault_v1;
      const count = data?.videos?.length ?? 0;
      countEl.textContent = String(count);
    } catch {
      countEl.textContent = '?';
    }
  }
})();
