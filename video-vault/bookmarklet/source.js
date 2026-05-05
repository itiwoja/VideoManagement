// ===== Source (read this to understand what it does) ======================
(function () {
  var meta = function (sel) {
    var el = document.querySelector(sel);
    return el ? el.getAttribute('content') : null;
  };

  var title =
    meta('meta[property="og:title"]') ||
    document.title ||
    'Untitled';

  var thumbnail =
    meta('meta[property="og:image"]') ||
    meta('meta[name="twitter:image"]') ||
    null;

  var duration =
    meta('meta[property="video:duration"]') ||
    meta('meta[property="og:video:duration"]') ||
    null;

  var payload = {
    url: location.href,
    title: title,
    thumbnail_url: thumbnail,
    duration: duration
  };

  fetch('http://127.0.0.1:3001/api/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.duplicate) {
        alert('既に登録済み: ' + (data.video && data.video.title));
      } else if (data.video) {
        alert('Vault に追加: ' + data.video.title);
      } else {
        alert('追加失敗: ' + (data.error || 'unknown'));
      }
    })
    .catch(function (e) {
      alert('接続失敗: backend が起動しているか確認してください\n' + e.message);
    });
})();
