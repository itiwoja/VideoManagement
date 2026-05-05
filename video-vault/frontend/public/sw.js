// public/sw.js
// 最小限の Service Worker。PWA インストール条件 + share_target 動作のため必要。
// キャッシュは現在のところしないので、毎回ネットワーク fetch を素通しする。
//
// Note: キャッシュ戦略を入れるとオフライン閲覧が可能になるが、Phase 4 以降に検討。

self.addEventListener('install', (event) => {
  // 即時アクティベート (古い SW を待たない)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // 透過 fetch。何もキャッシュしない。
  // Web Share Target は GET なのでここでも普通に流れる (URL = /share?...)
});
