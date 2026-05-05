# Video Vault

ローカルで動く動画お気に入り管理ツール。ブックマークレットでサクッと追加できる。

## 構成

```
video-vault/
├── backend/         Express + SQLite (port 3001, localhost only)
│   ├── lib/         Repository 層 (videos / tags / history / db)
│   ├── migrations/  PRAGMA user_version で idempotent
│   └── test/        node:test スモークテスト
├── frontend/        React 19 + Vite + Tailwind (port 5173)
│   ├── components/  StarRating / VideoCard / EditVideoDialog / TagFilterBar / HistoryView
│   └── lib/api.ts   型付き API クライアント
├── extension/       Chrome 拡張 (推奨 - 右クリック/ショートカット保存)
└── bookmarklet/     ブックマークレットのソース (extension が使えない時のフォールバック)
```

データは `backend/data.db` (SQLite) に保存される。サムネは URL のみ DB に持つ。

## セットアップ

Node.js 22.5 以上が必要 (`node:sqlite` を使うため)。

### 1. backend を起動

```powershell
cd backend
npm install
npm run dev
```

`http://127.0.0.1:3001` で待ち受け。`localhost` 以外からは受けない設定。
初回起動時に `data.db` がマイグレーションされる (`PRAGMA user_version` 管理)。

### 2. frontend を起動 (別ターミナル)

```powershell
cd frontend
npm install
npm run dev
```

ブラウザで `http://localhost:5173` を開く。

### 3. 動画を追加する経路（2 種類、どちらか好きな方を）

#### 推奨: Chrome 拡張機能

`extension/` を `chrome://extensions/` の「パッケージ化されていない拡張機能を読み込む」で読み込むと、
右クリック / `Ctrl+Shift+V` / ツールバーアイコンから保存できる。詳細は [`extension/README.md`](extension/README.md)。

#### フォールバック: ブックマークレット

1. Chrome のブックマークバーで右クリック → 「ブックマークを追加」
2. 名前: `Vaultに追加` (なんでもいい)
3. URL: `bookmarklet/bookmarklet.txt` の中身を全部コピペ (`javascript:` から始まる1行)
4. 動画ページを開いた状態でこのブックマークをクリック → アラートで追加完了

## 使い方

### Vault タブ

- 動画カードクリック → 元動画を新規タブで開いて視聴回数 +1 + 履歴に1行記録
- 「編集」ボタン → タイトル / 評価 (★0〜5) / メモ / タグの追加・削除
- 「削除」ボタン → 物理削除 (関連する履歴・タグ紐付けも CASCADE で消える)
- 上部の検索ボックスでタイトル / サイト名を部分一致絞り込み
- 並び替え: 追加日 / 視聴回数 / 最終視聴
- タグチップ: クリックでフィルタ ON / 同じタグを再クリックで OFF
- 評価フィルタ: すべて / 未評価 / ★3+ / ★4+ / ★5
- カードのタグもクリックでフィルタに乗る

### 履歴タブ

- 直近 100 件の視聴を新しい順に表示
- 期間絞り込み: 直近 7 日 / 直近 30 日 / 全期間
- 「履歴クリア」で全削除 (動画自体は残る)
- 履歴の行クリックで元動画を開く + 視聴回数 +1

## API

`localhost:3001` のみで待ち受け。認証なし (個人専用 + バインド制限による)。

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/health` | 死活確認 |
| GET | `/api/videos?q=&sort=&tag=&rating_min=&unrated=1` | 一覧 (フィルタ込み) |
| POST | `/api/videos` | 動画追加 (ブックマークレットが叩く) |
| PATCH | `/api/videos/:id` | `{ title?, rating?, note? }` の部分更新 |
| POST | `/api/videos/:id/view` | 視聴カウント +1 + 履歴記録 |
| DELETE | `/api/videos/:id` | 物理削除 |
| GET | `/api/tags` | 全タグ + 利用件数 |
| POST | `/api/videos/:id/tags` | `{ name }` でタグ付け (無ければ新規作成) |
| DELETE | `/api/videos/:videoId/tags/:tagId` | タグ解除 |
| GET | `/api/history?limit=50&since_days=7` | 視聴履歴 |
| DELETE | `/api/history?before=ISO` | 履歴削除 (`before` 省略で全削除) |

新規エンドポイント (`PATCH` / tags / history) は `{ ok: true, data: {...} }` 形式、
既存 (`/api/videos` GET POST など) は後方互換のため直接 JSON。

## DB スキーマ

```sql
videos (id, url UNIQUE, site, title, thumbnail_url, duration, added_at,
        view_count, last_viewed_at, rating, note)
tags (id, name UNIQUE)
video_tags (video_id, tag_id)  -- 多対多、CASCADE
view_history (id, video_id, viewed_at)  -- 詳細履歴
```

`PRAGMA user_version` でマイグレーションバージョンを管理。
旧 MVP の data.db でも `lib/db.js` の `migrate()` が ALTER TABLE と
`CREATE TABLE IF NOT EXISTS` で安全に Phase 2 のスキーマに上げる。

## テスト

backend を起動したまま、別ターミナルで:

```powershell
cd backend
npm test
```

`test/videos.test.js` は実 DB に対する最小限のスモーク (health / videos / tags / history /
PATCH バリデーションエラー)。CI 用には別途 in-memory DB を使う構成にする予定。

## Phase 3 (実装済): 認証 + PWA + Share Target

### 認証
- 初回起動時に `/setup` 画面でパスワードを設定 (bcryptjs hash, cost 12)
- ログインは HttpOnly Secure SameSite=Strict Cookie + JWT (14日)
- ブルートフォース対策: ログイン失敗 5回/分 で 60秒ロック (in-memory token bucket)
- パスワードは DB / log / response の生データに含まれない
- API トークン (sha256 hash 保存) を `/api/auth/tokens` から発行 → ブックマークレットや拡張で使う

### スマホ対応 (PWA + Web Share Target)
1. Tailscale Funnel 経由の HTTPS URL (`https://...:8443/`) をスマホ Chrome / Safari で開く
2. ブラウザメニュー → 「ホーム画面に追加」で **PWA としてインストール**
3. YouTube / X / TikTok 等の動画ページで「**共有**」→ 「Video Vault」を選択 → 自動保存
   - Android Chrome / Edge は Web Share Target API に対応
   - iOS Safari は限定対応 (`/share?url=...` を直接開く形は動作)

`public/manifest.webmanifest` の `share_target` で `/share` ルートに渡るパラメータを定義。
フロントの `ShareTargetHandler` が url を取り出して POST する。

### 環境変数 (backend/.env)
- `JWT_SECRET` — 必須。最低 32 文字、`openssl rand -base64 64` などで生成
- `BCRYPT_COST` — 任意、既定 12
- `COOKIE_SECURE` — 本番 (HTTPS) では `true`
- `HOST` / `PORT` — バインド設定

## まだやってない (Phase 4 候補)

- ローカルキャッシュ画像 (元サイト消失時の保険)
- タグ階層 / カテゴリ軸 (今は単一フラット)
- 一括編集 (複数選択 → タグ一括付与)
- 動画再生プレビュー (今は元サイトに飛ぶだけ)
- バックアップ / エクスポート (JSON ダンプ)

## メモ

- backend は `127.0.0.1` バインドなので外部からは触れない
- ブックマークレットからの POST は CORS 全許可 (localhost only サーバーなので OK)
- DB バックアップは `backend/data.db` を別の場所にコピーするだけ
- 削除は物理削除 (元に戻せない)
