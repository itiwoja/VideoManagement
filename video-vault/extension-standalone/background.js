// background.js
// MV3 service worker。
// - 右クリックメニュー / キーボードショートカット / popup から呼ばれて、
//   現在のタブを Vault に保存する
// - 保存後は通知 + バッジで結果を伝える

import { createVideo, listVideos } from './storage.js';

const CTX_MENU_ID = 'vault-save';

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: CTX_MENU_ID,
    title: 'Vault に保存',
    contexts: ['page', 'link', 'video'],
  });
  await refreshBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CTX_MENU_ID) return;
  // リンク URL を優先、それ以外はページ URL
  const url = info.linkUrl || info.srcUrl || tab?.url;
  const title = tab?.title;
  if (!url) {
    notify('保存できませんでした', 'URL を取得できません');
    return;
  }
  await saveAndNotify({ url, title });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save_current_tab') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;
  await saveAndNotify({ url: tab.url, title: tab.title });
});

// popup.js 等から呼ばれる runtime メッセージ
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'save_url' && typeof msg.url === 'string') {
    saveAndNotify({ url: msg.url, title: msg.title }).then((result) => {
      sendResponse(result);
    });
    return true; // async response
  }
  if (msg?.type === 'open_vault') {
    chrome.tabs.create({ url: chrome.runtime.getURL('vault.html') });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

/**
 * @param {{url: string, title?: string}} input
 * @returns {Promise<{ok: true, duplicate: boolean, video: any} | {ok: false, error: string}>}
 */
async function saveAndNotify(input) {
  try {
    // og:image / og:title を取りに行きたいが、background から fetch しても
    // CORS / Cookie 不整合で失敗するサイトが多い。content script に拾わせる手もあるが、
    // 初版は URL + title (タブのタイトル) だけで保存。
    const result = await createVideo({
      url: input.url,
      title: input.title,
      thumbnailUrl: null,
    });
    if (result.duplicate) {
      notify('既に保存済み', `${result.video.title}`);
    } else {
      notify('Vault に保存しました', `${result.video.title}`);
    }
    await refreshBadge();
    return { ok: true, duplicate: result.duplicate, video: result.video };
  } catch (err) {
    notify('保存失敗', err instanceof Error ? err.message : 'unknown error');
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title,
    message,
  });
}

async function refreshBadge() {
  const videos = await listVideos();
  const count = videos.length;
  await chrome.action.setBadgeText({
    text: count === 0 ? '' : count > 999 ? '999+' : String(count),
  });
  await chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
}
