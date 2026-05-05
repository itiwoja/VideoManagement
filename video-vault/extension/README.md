# Video Vault Saver (Chrome Extension)

ブックマークレットの上位互換。動画ページや任意のリンクを **右クリック / ショートカット / ツールバーアイコン** から
ローカルの Video Vault に 1 クリックで保存できる Chrome 拡張機能 (Manifest V3)。

## できること

| 起動方法 | 動作 |
|---|---|
| ツールバーアイコンをクリック → 「このページを保存」 | 現在のタブを保存 |
| ページ上で右クリック → 「このページを Vault に保存」 | 現在のタブを保存 |
| リンク上で右クリック → 「リンクを Vault に保存」 | リンク先 URL を保存 |
| 動画要素上で右クリック → 「動画を Vault に保存」 | 動画要素 (video タグ) の URL を保存 |
| `Ctrl + Shift + V` (Win) / `⌘ + Shift + V` (Mac) | 現在のタブを保存 |

成功 / 失敗・重複は通知センターに表示される。

## インストール (開発モード)

1. **backend を先に起動** ( `cd ../backend && npm install && npm run dev` )
2. Chrome で `chrome://extensions/` を開く
3. 右上のトグル **「デベロッパーモード」** をオン
4. 左上の **「パッケージ化されていない拡張機能を読み込む」** をクリック
5. このフォルダ (`extension/`) を選択
6. ツールバーにアイコンが出れば成功

> アイコンは `generate-icons.ps1` で生成済み。デザインを差し替えたい場合は同じファイル名 (`icon-{16,48,128}.png`) で上書き。

## 設定

ツールバーアイコンの popup → 「設定」リンク、または `chrome://extensions/` の本拡張の「拡張機能のオプション」から：

- **Backend URL**: 既定 `http://127.0.0.1:3001`。Tailscale Funnel 経由などで HTTPS の URL に向けたい時に変更。
- **接続テスト** ボタンで `/api/health` を叩いて疎通確認できる。

## 仕組み

- `background.js` (Service Worker) が contextMenus / commands / action.popup を仲介する
- 保存対象の URL がタブ自身なら `chrome.scripting.executeScript` で og:meta を取得（ブックマークレットと同じ）
- リンク / 動画要素なら URL のみ送信（タイトルはホスト名を仮置き、後で Vault 側で編集する想定）
- POST 先は `chrome.storage.sync.apiBase` 設定値、未設定なら `http://127.0.0.1:3001`

## 既知の制約

- `chrome://`, `about://`, `chrome-extension://` などのページは内容にアクセスできないので保存できない（通知で弾く）
- og:meta が無いサイトでは title が「(ホスト名)」になる。Vault 側で「編集」から書き換えてください
- `host_permissions` に `<all_urls>` を含むので、初回読み込み時に Chrome から警告が出ます（社外配布する場合は最小権限に絞る）
