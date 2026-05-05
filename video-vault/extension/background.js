// background.js
// Service Worker (MV3). 3 つの起動経路を持つ:
//
//   1. ツールバーアイコンのクリック     → 現在のタブを保存
//   2. ページ / リンクの右クリック     → 対象 URL を保存
//   3. キーボードショートカット (Ctrl+Shift+V) → 現在のタブを保存
//
// いずれも content script を inject してメタデータ抽出 → backend に POST する。

const DEFAULT_API = 'http://127.0.0.1:3001';

async function getConfig() {
  const stored = await chrome.storage.sync.get({
    apiBase: DEFAULT_API,
    apiToken: '',
  });
  return {
    apiBase: (stored.apiBase || DEFAULT_API).replace(/\/$/, ''),
    apiToken: (stored.apiToken || '').trim(),
  };
}

/**
 * @typedef {Object} VideoPayload
 * @property {string} url
 * @property {string} title
 * @property {string|null} thumbnail_url
 * @property {string|null} duration
 */

/**
 * @param {number} tabId
 * @param {string} url      ページ URL もしくは右クリックされたリンク URL
 * @returns {Promise<VideoPayload>}
 */
async function extractMetadata(tabId, url) {
  // タブ内で og:meta を読む。リンクを保存する場合 (url がタブ URL と異なる) は
  // タブのメタは使えないので最低限のフォールバックを返す。
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (currentUrl) => {
        const metaContent = (sel) => {
          const el = document.querySelector(sel);
          return el ? el.getAttribute('content') : null;
        };
        return {
          tabUrl: location.href,
          title:
            metaContent('meta[property="og:title"]') ||
            document.title ||
            'Untitled',
          thumbnail:
            metaContent('meta[property="og:image"]') ||
            metaContent('meta[name="twitter:image"]') ||
            null,
          duration:
            metaContent('meta[property="video:duration"]') ||
            metaContent('meta[property="og:video:duration"]') ||
            null,
          requested: currentUrl,
        };
      },
      args: [url],
    });

    // 取得したメタはタブのものなので、リンク URL を保存する場合は title を URL に置き換える方が無難
    if (result && result.tabUrl === url) {
      return {
        url,
        title: result.title,
        thumbnail_url: result.thumbnail,
        duration: result.duration,
      };
    }
    // リンク保存: ホスト名ベースの仮タイトル
    return {
      url,
      title: hostnameFallbackTitle(url),
      thumbnail_url: null,
      duration: null,
    };
  } catch {
    return {
      url,
      title: hostnameFallbackTitle(url),
      thumbnail_url: null,
      duration: null,
    };
  }
}

/**
 * @param {string} url
 */
function hostnameFallbackTitle(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Untitled';
  }
}

/**
 * @param {VideoPayload} payload
 */
async function saveToVault(payload) {
  const { apiBase, apiToken } = await getConfig();
  const headers = { 'Content-Type': 'application/json' };
  if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;
  const res = await fetch(`${apiBase}/api/videos`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (res.status === 401) {
    throw new Error('認証失敗 — 設定で API トークンを確認してください');
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * @param {string} title
 * @param {string} message
 * @param {'basic'|'image'|'list'|'progress'} [type]
 */
function notify(title, message, type = 'basic') {
  // notifications.create はアイコン必須。manifest に icon があれば自動で使われる。
  chrome.notifications.create({
    type,
    iconUrl: 'icon-128.png',
    title,
    message,
    priority: 0,
  });
}

/**
 * @param {chrome.tabs.Tab} tab
 * @param {string|null} explicitUrl  右クリックされたリンクの URL (なければタブ URL を使う)
 */
async function saveTabOrLink(tab, explicitUrl) {
  const targetUrl = explicitUrl || tab?.url;
  if (!tab || !targetUrl) {
    notify('Vault: 保存失敗', 'タブ情報が取れませんでした');
    return;
  }
  // chrome:// や about:// には scripting できない
  if (/^(chrome|about|edge|brave|chrome-extension):/i.test(targetUrl)) {
    notify('Vault: 保存対象外', '内部ページは保存できません');
    return;
  }

  try {
    const payload = await extractMetadata(tab.id, targetUrl);
    const data = await saveToVault(payload);
    if (data && data.duplicate) {
      notify('Vault: 既に登録済み', payload.title);
    } else {
      notify('Vault: 追加しました', payload.title);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notify('Vault: 保存失敗', `backend が起動しているか確認してください\n${msg}`);
  }
}

// ---------------------------------------------------------------- context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'vv-save-page',
    title: 'このページを Vault に保存',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'vv-save-link',
    title: 'リンクを Vault に保存',
    contexts: ['link'],
  });
  chrome.contextMenus.create({
    id: 'vv-save-video',
    title: '動画を Vault に保存',
    contexts: ['video'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'vv-save-page':
      void saveTabOrLink(tab, null);
      break;
    case 'vv-save-link':
      void saveTabOrLink(tab, info.linkUrl ?? null);
      break;
    case 'vv-save-video':
      void saveTabOrLink(tab, info.srcUrl ?? info.linkUrl ?? null);
      break;
  }
});

// ---------------------------------------------------------------- toolbar action
// popup を持つので action.onClicked は popup を表示しない時だけ発火する。
// popup から「保存」ボタン経由で呼びたい時のために `chrome.runtime.sendMessage` を待ち受け。
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'vv:save-current') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab) return;
      saveTabOrLink(tab, null).then(() => sendResponse({ ok: true }));
    });
    return true; // keep channel open for async response
  }
});

// ---------------------------------------------------------------- shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'save_current_tab') return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab) return;
    void saveTabOrLink(tab, null);
  });
});
