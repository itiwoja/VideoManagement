# Video Vault

ローカルで動く動画お気に入り管理ツール。ブックマークレットでサクッと追加できる。

## 構成

```
video-vault/
├── backend/         Express + SQLite (port 3001, localhost only)
├── frontend/        React 19 + Vite + Tailwind (port 5173)
└── bookmarklet/     ブックマークレットのソース
```

データは `backend/data.db` (SQLite) に保存される。サムネは URL のみ DB に持つ。

## セットアップ

Node.js 20 以上が必要。

### 1. backend を起動

```powershell
cd backend
npm install
npm run dev
```

`http://127.0.0.1:3001` で待ち受け。`localhost` 以外からは受けない設定。

### 2. frontend を起動 (別ターミナル)

```powershell
cd frontend
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開く。

### 3. ブックマークレットを登録

1. Chrome のブックマークバーで右クリック → 「ブックマークを追加」
2. 名前: `Vaultに追加` (なんでもいい)
3. URL: `bookmarklet/bookmarklet.txt` の中身を全部コピペ (`javascript:` から始まる1行)
4. 動画ページを開いた状態でこのブックマークをクリック → アラートで追加完了

## 使い方

- 動画カードクリック → 元動画を新規タブで開いて視聴回数 +1
- 上部の検索ボックスでタイトル/サイト名を絞り込み
- 並び替え: 追加日 / 視聴回数 / 最終視聴

## Phase 2 として残したもの

- パスワードロック (bcrypt + JWT)
- タグ・カテゴリ
- 評価・メモ
- 視聴履歴詳細
- ローカルキャッシュ画像へのフォールバック

## メモ

- backend は `127.0.0.1` バインドなので外部からは触れない
- ブックマークレットからの POST は CORS 全許可 (localhost only サーバーなので OK)
- DB バックアップは `backend/data.db` を別の場所にコピーするだけ
- 削除は物理削除 (元に戻せない)
