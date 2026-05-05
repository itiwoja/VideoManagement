# PRP: Video Vault Phase 2

> ECC `/prp-prd` 方式で書いた Product Requirements + Plan ドキュメント。
> 現状 MVP（追加・検索・並べ替え・閲覧カウント・削除）に対し、README で
> 約束していた Phase 2 を実装する。

---

## 1. 現状

- localhost 限定の動画 bookmark + ライブラリツール（Express + node:sqlite + React 19）
- 入力動線はブックマークレット（POST /api/videos）
- 動画ページの og:title / og:image / video:duration をスクレイプして登録
- フロントは検索 + 3 軸ソート（追加日 / 視聴回数 / 最終視聴）

### 既存スキーマ

```sql
CREATE TABLE videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  site TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_url TEXT,
  duration TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TEXT
);
```

## 2. Phase 2 のスコープと優先順位

README に挙げた 5 項目を、ROI で並べ替え。

| 優先 | 項目 | 価値 | 複雑度 |
|---|---|---|---|
| **P1** | タグ・カテゴリ | 整理・絞り込みの基本軸、即体感 | 中 |
| **P1** | 評価・メモ | 「なぜ保存したか」を残せる、再訪価値 UP | 小 |
| **P2** | 視聴履歴詳細 | パターン分析・再発見に効く | 中 |
| P3 | ローカルキャッシュ画像 | 元サイトが消えた時の保険 | 大 |
| P4 | パスワードロック | localhost only なので実害低、Tailscale 経由でだけ必要 | 中 |

**今回の射程: P1 + P2 を実装する**（P3/P4 は別フェーズ）。

## 3. ユーザーストーリー

- **S1: タグ付け** — 動画を保存後、タグを付け足して整理したい
- **S2: 評価** — 後でまた見たい度合を ★1〜5 で記録したい
- **S3: メモ** — 「この場面が良い」「BGM 元」みたいな短いメモを残したい
- **S4: タグ絞り込み** — タグでフィルタしてリストを狭めたい
- **S5: 視聴履歴** — いつ・どの動画を何回見たかの軌跡を見たい
- **S6: 履歴クリア** — 履歴を消したい時は消せる（プライバシー配慮）

## 4. データモデル

### 4-1. videos テーブル: 追加カラム

```sql
ALTER TABLE videos ADD COLUMN rating INTEGER;       -- 0..5, NULL=未評価
ALTER TABLE videos ADD COLUMN note TEXT;            -- 自由記述メモ
```

### 4-2. tags テーブル（新規）

```sql
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE video_tags (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);
CREATE INDEX idx_video_tags_video ON video_tags(video_id);
CREATE INDEX idx_video_tags_tag   ON video_tags(tag_id);
```

「カテゴリ」はタグの 1 種として扱う（接頭辞 `cat:` などで分類しても OK だが、
最初は単一軸のフラットな tags で始め、必要になったら拡張する）。

### 4-3. view_history テーブル（新規）

```sql
CREATE TABLE view_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  viewed_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_view_history_video ON view_history(video_id);
CREATE INDEX idx_view_history_viewed_at ON view_history(viewed_at DESC);
```

既存の `videos.view_count` / `videos.last_viewed_at` は denormalize として残す
（高速ソート用）。

## 5. API 仕様（追加・変更）

ECC の `ApiResponse<T>` パターンに概ね沿う。既存は `{ videos: [...] }` みたいな
直接形式なので、互換のため既存はそのままにし、新規エンドポイントだけ
`{ ok, data, error }` 形式にする。

### 既存

| Method | Path | 変更点 |
|---|---|---|
| GET | `/api/videos` | クエリに `tag` `rating_min` を追加。`tags`/`note`/`rating` を返却に含める |
| POST | `/api/videos` | 変更なし |
| POST | `/api/videos/:id/view` | view_history にも 1 行 INSERT する |
| DELETE | `/api/videos/:id` | 変更なし（CASCADE で view_history と video_tags も消える） |
| GET | `/api/health` | 変更なし |

### 新規

| Method | Path | 概要 |
|---|---|---|
| PATCH | `/api/videos/:id` | `{ rating?, note?, title? }` の部分更新 |
| GET | `/api/tags` | 全タグ + 件数 `[{ id, name, count }]` |
| POST | `/api/videos/:id/tags` | `{ name }` でタグ付け（無ければ新規作成） |
| DELETE | `/api/videos/:videoId/tags/:tagId` | タグ解除 |
| GET | `/api/history?limit=50` | 視聴履歴を新しい順に |
| DELETE | `/api/history` | 履歴全削除（オプションで `?before=ISO` で範囲削除） |

すべて `127.0.0.1` バインドのまま、認証なし運用を踏襲。

## 6. フロントエンド変更

### 6-1. VideoCard

- ★rating 表示（hover で編集ポップオーバー）
- note があれば `📝` バッジ表示（hover で内容を tooltip）
- タグチップ表示（最大 3 個 + 残数）

### 6-2. ヘッダー

- 既存の検索ボックス + ソートに加えて：
  - タグフィルタチップ列（クリックで AND フィルタ）
  - 評価フィルタ（★3 以上 / 未評価のみ など）

### 6-3. 編集モーダル

- カードの「⋯」メニューから開く
- 編集できる項目: タイトル / 評価 / メモ / タグ（追加・削除）
- shadcn 風だが既存スタックに合わせ Tailwind の素のコンポーネントで（依存追加なし）

### 6-4. 履歴ページ（新規ルート `/history`）

- React Router を入れずに、既存単一ページ内のタブ切替で
  `[Vault] [履歴]` を出す（依存追加を抑える）
- 直近 50 件のタイムライン表示
- 「7日 / 30日 / 全期間」フィルタ
- 「履歴クリア」ボタン（confirm 必須）

## 7. 実装フェーズ

### Step 1: スキーマ + マイグレーション (40 分)

- `backend/migrations/` ディレクトリ新設
- `001_init.sql`: 既存スキーマ
- `002_phase2.sql`: ALTER + 新規 2 テーブル
- `migrate.js` を起動時に実行（idempotent: `PRAGMA user_version` で管理）

### Step 2: バックエンドエンドポイント追加 (60 分)

- リポジトリ層 `lib/videos.js` `lib/tags.js` `lib/history.js` に分離
- ECC Repository パターン: `findAll(filters)` `findById(id)` `update(id, dto)` 等
- Zod なしで OK（バックエンドは JS、入力バリデーションは手書き、軽量に）

### Step 3: フロント API クライアント拡張 (30 分)

- `src/lib/api.ts` に集約（既存は App.tsx に直 fetch なので分離）
- TypeScript 型 `Video` `Tag` `HistoryEntry` を `src/types.ts` に

### Step 4: VideoCard 拡張 (45 分)

- rating 編集ポップオーバー（onClick 外側で close）
- タグチップ表示
- メモアイコン

### Step 5: 編集モーダル (60 分)

- `EditVideoDialog.tsx` 作成
- title / rating / note / tags の単一フォーム
- ESC で閉じる

### Step 6: タグフィルタ + 評価フィルタ (30 分)

- ヘッダーに追加
- URL search params に同期（`?tag=foo&rating_min=3`）

### Step 7: 履歴ページ (40 分)

- タブ切替で表示
- timeline 表示

### Step 8: テスト (30 分)

- Vitest + supertest で backend の主要ルート
- Playwright は今回は省略（後で）

**累計: 約 5.5 時間 = 1〜2 セッション**

## 8. リスク & 緩和

| リスク | 対策 |
|---|---|
| ALTER TABLE で既存 DB が壊れる | `PRAGMA user_version` でガード、各マイグレーションは idempotent |
| タグ名の表記ゆれ（"VTuber" vs "vtuber"） | `name` を `LOWER(name)` で UNIQUE、表示は元の casing を保持 |
| 履歴の肥大化 | デフォで `viewed_at` 降順 50 件、`?before=` で削除可能 |
| ブックマークレットが古い動作のまま | Phase 2 では bookmarklet は触らない（将来 tag を URL params で受け取れるように） |

## 9. 完了条件

- [ ] backend に新 6 エンドポイント追加・既存 view が history INSERT する
- [ ] DB マイグレーションは既存 data.db でも非破壊で動く
- [ ] フロントで rating / note / tags / history が編集・閲覧できる
- [ ] tsc + ESLint パス（フロントエンド）
- [ ] backend `npm test` の主要ケース (POST videos / PATCH / tags / history) が緑
- [ ] README の Phase 2 セクションに「実装済み」マーク + スクショ

## 10. 非ゴール（やらない）

- パスワード認証（localhost only 前提を維持）
- ローカルキャッシュ画像（後フェーズ）
- マルチユーザー（個人専用）
- 動画再生機能の内蔵（クリックで元サイトに飛ぶ動線を維持）
- React Router 導入（タブ切替で済ませる）

---

> このプランで進める。Step 1 から順に実装し、各 Step ごとにテスト → 次へ。
> ECC の `tdd-workflow` の精神で、変更前にケースを 1 件書く・通す・次に進める。
