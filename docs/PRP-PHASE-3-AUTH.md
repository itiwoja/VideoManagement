# PRP: Video Vault Phase 3 — Password Authentication

> ECC `/prp-prd` 方式 + ECC `security-reviewer` の観点で書いた、パスワード認証導入の
> 設計 + セキュリティチェックリスト。

---

## 1. 背景

Phase 2 までの video-vault は localhost only で動かす想定だったが、Tailscale Funnel
(`:8443`) で **公開URLからアクセス可能** になった。Funnel の URL は推測されにくい
とはいえ、知ってさえいれば誰でも触れる状態。**個人データ + 視聴履歴** という機密度を
踏まえ、認証層を追加する。

## 2. 脅威モデル

| 脅威 | 対策 |
|---|---|
| 公開URLを偶然訪れた他者がデータを閲覧/改変 | パスワード認証必須 |
| パスワード平文流出 (log / DB / response) | bcrypt ハッシュのみ DB に保存、ログ・レスポンスに一切含めない |
| ブルートフォース | login 失敗時のレート制限 (token bucket、IP+全体) |
| セッションハイジャック | HTTPS 限定 + Cookie に `HttpOnly` `Secure` `SameSite=Strict` |
| XSS で Cookie 盗難 | `HttpOnly` で JS からアクセス不可 |
| CSRF | `SameSite=Strict` + state-changing リクエストは Origin チェック |
| JWT 鍵流出 | 環境変数 (`JWT_SECRET`) のみ、コードに hard-code しない |
| タイミング攻撃 | bcrypt.compare で固定時間比較 |
| ユーザー列挙 | "password incorrect" or "user not exists" を区別しない (実質単一ユーザーだが) |

## 3. データモデル追加

```sql
-- 003_auth.sql
CREATE TABLE IF NOT EXISTS auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- 単一ユーザー専用
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- API トークン (bookmarklet / 拡張用、ハッシュ保存)
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,         -- "bookmarklet" "chrome-ext" など識別ラベル
  token_hash TEXT NOT NULL UNIQUE, -- sha256 で十分 (生トークンは128bit以上)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);
```

`PRAGMA user_version = 3` に上げる。既存 data.db でも `IF NOT EXISTS` で安全。

## 4. 認証フロー

### 初回セットアップ
1. backend 起動時に `auth` テーブルが空だと「未セットアップ」状態
2. UI が `/setup` 画面を出す
3. `POST /api/auth/setup { password }` で初回パスワード登録
4. 同時にログイン状態に (Cookie 発行)

### 通常ログイン
1. UI に password 入力フォーム
2. `POST /api/auth/login { password }` 
3. bcrypt.compare → 成功なら JWT を `HttpOnly` Cookie に set
4. UI は `/me` を fetch して認証状態を確認、Vault 画面に遷移

### ログアウト
- `POST /api/auth/logout` → Cookie をクリア

### API トークン (bookmarklet / 拡張)
1. UI のセットアップ画面で「トークン作成」→ 生 token を 1 度だけ表示
2. クライアント (拡張・ブックマークレット) は `Authorization: Bearer <token>` で送信
3. backend は sha256(token) を auth.api_tokens.token_hash と照合

### パスワード変更
- `POST /api/auth/change { current, next }` 認証必須

## 5. ECC TypeScript セキュリティルール準拠

| 項目 | 状況 |
|---|---|
| ハードコード秘密の禁止 | `JWT_SECRET` を `.env` から読む。未設定時は **起動失敗** |
| `bcrypt` cost factor | 12 (環境により 10-14 で調整可) |
| 失敗時のメッセージ | 認証失敗は `401 unauthorized` のみ。詳細を漏らさない |
| ログ | 失敗ログには IP のみ、入力 password は決して書かない |
| Cookie flags | `HttpOnly + Secure + SameSite=Strict + Path=/` |
| HTTPS | 本番 (Tailscale Funnel) で自動 HTTPS。dev でも secure flag は動く (localhost例外) |
| 入力検証 | password は length 8〜128、`Zod` 風に手書きバリデーション (依存追加なし) |
| レート制限 | `/api/auth/login` `/api/auth/setup` に IP ごと 5 req/min |
| CSRF | `SameSite=Strict` + 状態変更リクエストに Origin ヘッダ確認 |

## 6. 実装計画

### Step 1: backend/lib/auth.js (40 分)
- `hashPassword(plain): Promise<string>` — bcryptjs (依存追加: `bcryptjs` `jsonwebtoken`)
- `verifyPassword(plain, hash): Promise<boolean>`
- `createSessionJWT(): string` — exp 14日、secret は env
- `verifySessionJWT(token): { ok: boolean }`
- `hashApiToken(raw): string` — sha256
- API トークン CRUD

### Step 2: backend/lib/auth-mw.js (30 分)
- `requireAuth(req, res, next)` ミドルウェア
- Cookie か `Authorization: Bearer` どちらかを受け付ける
- 401 で content-type=application/json + 単一 message

### Step 3: backend/lib/rate-limit.js (20 分)
- in-memory token bucket、`limit(key, max=5, windowMs=60_000)`
- `/login` `/setup` に適用

### Step 4: server.js への組込 (40 分)
- `/api/auth/setup` `/login` `/logout` `/me` `/change` `/tokens` 各エンドポイント
- 既存の `/api/videos` `/api/tags` `/api/history` に `requireAuth` ミドルウェア
- `/api/health` だけ素通し

### Step 5: マイグレーション (15 分)
- `migrations/003_auth.sql`
- `lib/db.js` に v3 ブロック追加

### Step 6: frontend (60 分)
- `src/lib/auth.ts` — login / logout / me 関数
- `src/components/SetupScreen.tsx` — 初回パスワード設定
- `src/components/LoginScreen.tsx` — ログイン
- `App.tsx` を AuthGate でラップ。401 時にログイン画面に戻す
- ヘッダーにログアウトボタン

### Step 7: Chrome 拡張対応 (30 分)
- `options.html` に「API トークン」入力欄
- リクエストで `Authorization: Bearer` を付与

### Step 8: テスト + Security review (40 分)
- node:test に auth ケース追加 (login OK / password wrong / rate limit / setup-twice 防止)
- ECC `security-review` 観点でセルフレビュー

**累計: 約 4.5 時間 = 1〜2 セッション**

## 7. .env テンプレート

`backend/.env.example` を新規作成:

```env
# 起動に必須。openssl rand -base64 64 などで生成。
JWT_SECRET=

# bcrypt コストファクタ (10-14 推奨、デフォルト 12)
# BCRYPT_COST=12

# Cookie の Secure flag (本番で true)
# COOKIE_SECURE=true

# 起動時バインドアドレス
# HOST=127.0.0.1
# PORT=3001
```

`.env` 自体は `.gitignore` で除外済 (`/.env`)。

## 8. リスクと緩和

| リスク | 緩和 |
|---|---|
| JWT_SECRET をバージョン管理にコミット | `.gitignore` で `.env` 除外、`.env.example` のみコミット |
| 既存 data.db が破壊される | migration 003 は CREATE TABLE IF NOT EXISTS のみ、ALTER なし |
| ログインロックでロックアウト | rate limit は IP 単位、本人がリセット可能 (再起動でクリア) |
| bookmarklet が動かなくなる | 後方互換: API トークン未設定なら従来通り 401 を返す → 拡張 / 新 bookmarklet で対応 |
| Tailscale Funnel + 認証なしの空白期間 | このフェーズが完了するまで、Funnel を一時的に内向き (serve のみ) に戻すか、リスク受容 |

## 9. 完了条件

- [ ] 初回起動で `/setup` 画面が出て、パスワード設定できる
- [ ] 設定後、再ログインなしで Vault が見える
- [ ] ブラウザを閉じる → 14日後にログイン要求
- [ ] パスワード違いで 5 回失敗 → 60 秒待ち
- [ ] `/api/videos` などに未認証アクセス → 401
- [ ] パスワードがレスポンス・ログ・DB の生データに一切含まれない
- [ ] Chrome 拡張で API トークン経由で保存できる
- [ ] node:test 認証ケース緑

## 10. ECC `security-reviewer` 観点のセルフチェックリスト

- [ ] hardcoded secret なし (grep で `'supersecret'` `'changeme'` 等チェック)
- [ ] bcrypt cost >= 12
- [ ] JWT_SECRET 未設定時は起動失敗
- [ ] エラーメッセージに spec 情報を含めない (例: "user not found" → "auth failed")
- [ ] レート制限あり
- [ ] Cookie 全フラグ (HttpOnly/Secure/SameSite/Path)
- [ ] CSRF: state-changing は GET でなく POST/PATCH/DELETE
- [ ] 入力長制限あり (password 128 chars max)
- [ ] パスワードログ禁止 (logger 通したら redact)
- [ ] timing attack 耐性 (bcrypt.compare 使用)

---

> 次: Step 1 から実装。各 Step ごとにコミット → push。
