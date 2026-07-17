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

## 設計方針

### 完全ローカル・プライバシー特化

- 視聴データ (何を見たか・いつ見たか) は一切外部に送信しない。これはこのアプリの方針であり、機能追加時の判断基準にする
- backend は `127.0.0.1` / Tailscale バインドのみ、外部公開なし (既出)
- テレメトリ・アクセス解析・クラッシュレポート等の外部送信系は組み込まない (実装済み機能にも該当コードなし)
- クラウド同期なし。バックアップは手動で `data.db` をコピーするだけ
- クラウド系ブックマークサービスとの差別化ポイントであり、視聴履歴という機微データを扱う以上、最大の信頼要素として扱う
- 今後 AI 機能 (レコメンド・自動タグ付け・セマンティック検索等) を追加する場合もこの方針を優先する
  - デフォルトはローカル処理 (埋め込み・推論をローカルで完結させる)
  - 外部 API 呼び出しがどうしても必要な場合 (例: タグ提案に Claude API を使う等) は、唯一の・明示的な・opt-in の例外として扱う。他のデータ送信を正当化する前例にはしない

### 「消えないVault」

ブックマーク管理ツールは元動画が消えるとリンクだけが残って終わるが、Video Vault は
「保存した時点のコレクションを守り切る」ことを目指す。3本柱:

- **ゴミ箱 (soft-delete)**: 削除しても即消えず 30日間ゴミ箱で復元可能、期限切れは自動パージ (#10)
- **リンク切れ検知**: 6時間ごとに保存済み URL を HEAD/GET チェックし、404/410/DNS 消失を `link_status='broken'` として検出 (`GET /api/videos?broken=1` で一覧)。元サイトが消えても気づかず放置しない (#8)
- **サムネイルのローカルキャッシュ**: 15分ごとに外部 URL のままのサムネイルを `backend/data/thumbnails/` にダウンロードし、`/thumbs/<id>.<ext>` で配信 (要ログイン、同一オリジンの Cookie で認証)。元画像 URL が失効しても表示が壊れない (#7)

この3つ (削除への保険・リンク切れの可視化・サムネ URL からの独立) をまとめて
「元が消えてもコレクションは残る」という一つの体験として位置づける。これが
ブックマーク系サービスに対する最大の差別化ポイント。

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
- 「削除」ボタン → ゴミ箱へ移動 (物理削除ではない、30日間は「ゴミ箱」タブから復元可能)
- 「選択」ボタン → 複数選択モード。チェックした動画へタグ一括付与 / 一括でゴミ箱へ移動
- 上部の検索ボックスでタイトル / サイト名 / メモ / タグを横断検索 (3文字以上は全文検索、未満は部分一致)
- 並び替え: 追加日 / 視聴回数 / 最終視聴
- タグチップ: クリックでフィルタ ON / 同じタグを再クリックで OFF
- 評価フィルタ: すべて / 未評価 / ★3+ / ★4+ / ★5
- カードのタグもクリックでフィルタに乗る

### 履歴タブ

- 直近 100 件の視聴を新しい順に表示
- 期間絞り込み: 直近 7 日 / 直近 30 日 / 全期間
- 「履歴クリア」で全削除 (動画自体は残る)
- 履歴の行クリックで元動画を開く + 視聴回数 +1

### ゴミ箱タブ

- 削除した動画が 30 日間ここに残る (期限切れは自動パージ)
- 「復元」で Vault タブに戻す、「完全に削除」で即座にパージ (元に戻せない)

### 発掘タブ

- 「未視聴」: 保存したまま一度も見ていない動画 (追加日が古い順)
- 「見返していない高評価」: ★4以上なのに30日以上見返していない動画

## API

`localhost:3001` のみで待ち受け。Cookie (JWT) または API トークンによる認証必須
(`/api/health` を除く)。詳細は下記「Phase 3」参照。

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/health` | 死活確認 (認証不要) |
| GET | `/api/videos?q=&sort=&tag=&rating_min=&unrated=1&broken=1` | 一覧 (フィルタ込み、`broken=1` でリンク切れのみ) |
| POST | `/api/videos` | 動画追加 (ゴミ箱内の同一 URL があれば復元扱い) |
| PATCH | `/api/videos/:id` | `{ title?, rating?, note? }` の部分更新 |
| POST | `/api/videos/:id/view` | 視聴カウント +1 + 履歴記録 |
| DELETE | `/api/videos/:id` | ゴミ箱へ移動 (論理削除) |
| GET | `/api/videos/trash` | ゴミ箱一覧 (アクセス時に期限切れを自動パージ) |
| POST | `/api/videos/:id/restore` | ゴミ箱から復元 |
| DELETE | `/api/videos/:id/purge` | ゴミ箱から完全削除 (元に戻せない) |
| GET | `/api/videos/hidden-gems` | 「埋もれ発掘」: 未視聴 / 見返していない高評価 |
| POST | `/api/videos/:id/suggest-tags` | Claude API でタグ候補提案 (`ANTHROPIC_API_KEY` 未設定なら常に `[]`) |
| GET | `/api/tags` | 全タグ + 利用件数 |
| POST | `/api/videos/:id/tags` | `{ name }` でタグ付け (無ければ新規作成) |
| DELETE | `/api/videos/:videoId/tags/:tagId` | タグ解除 |
| GET | `/api/history?limit=50&since_days=7` | 視聴履歴 |
| DELETE | `/api/history?before=ISO` | 履歴削除 (`before` 省略で全削除) |
| GET | `/api/jobs` | 定期ジョブ (サムネ補完・リンク切れ検知等) の実行状況 |
| GET | `/thumbs/:filename` | ローカルキャッシュ済みサムネイル画像の配信 (`/api` 配下ではないが要認証) |

新規エンドポイント (`PATCH` / tags / history / trash 等) は `{ ok: true, data: {...} }` 形式、
既存 (`/api/videos` GET POST など) は後方互換のため直接 JSON。

## DB スキーマ

```sql
videos (id, url UNIQUE, site, title, thumbnail_url, duration, added_at,
        view_count, last_viewed_at, rating, note,
        deleted_at,                    -- NULL 以外ならゴミ箱入り (#10)
        link_status, link_checked_at)  -- 'ok' | 'broken' | 'unknown' (#8)
tags (id, name UNIQUE)
video_tags (video_id, tag_id)  -- 多対多、CASCADE
view_history (id, video_id, viewed_at)  -- 詳細履歴
videos_fts (title, note, tags_text)  -- FTS5 trigram, videos.id と 1:1 (#12)
```

`PRAGMA user_version` でマイグレーションバージョンを管理。
旧 MVP の data.db でも `lib/db.js` の `migrate()` が ALTER TABLE と
`CREATE TABLE IF NOT EXISTS` で安全に Phase 2 のスキーマに上げる。

## テスト

```powershell
cd backend
npm test
```

`test/videos.test.js` は `DB_PATH=:memory:` の使い捨てサーバーを自前で spawn するので、
dev server が起動していなくてもそのまま動く (health / auth / CSRF / videos CRUD / tags /
history / trash の結合テスト)。`.github/workflows/ci.yml` で push / PR ごとに自動実行される。

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

- タグ階層 / カテゴリ軸 (今は単一フラット)
- バックアップ / エクスポート (JSON ダンプ)

## メモ

- backend は `127.0.0.1` バインドなので外部からは触れない
- CORS は allowlist 方式 (`ALLOWED_ORIGINS` 環境変数)。状態変更系リクエストは Origin/Referer を
  検証する CSRF ガードも通る (SameSite=Strict Cookie に加えた多層防御)
- DB バックアップは `backend/data.db` を別の場所にコピーするだけ
- 削除はゴミ箱への論理削除 (30日で自動パージ)。即座に完全削除したい場合はゴミ箱から「完全に削除」
