# VideoManagement

お気に入りのビデオを1元管理する自作ツール。

## 中身

- [`video-vault/`](video-vault/) — メイン実装。Express + SQLite + React 19 + Vite + Tailwind の
  ローカル専用 Web アプリ + ブックマークレット。
- [`docs/`](docs/) — 設計ドキュメント。Phase 計画など。

詳しい使い方とセットアップは [`video-vault/README.md`](video-vault/README.md)、
Phase 2 実装計画は [`docs/PRP-PHASE-2.md`](docs/PRP-PHASE-2.md) を参照。

## 主な機能

- ブックマークレット 1 クリックで動画ページを保存（YouTube / X / TikTok 等の og:title / og:image を抽出）
- ローカル SQLite に永続化 (`backend/data.db`)
- タグ・評価・メモ・視聴履歴を一括管理
- タグ / 評価 / サイト で絞り込み、追加日 / 視聴回数 / 最終視聴 で並び替え
- 履歴ビューで「いつ何見たか」を時系列に確認
- すべて localhost バインド、外部公開なし

## 技術スタック

| 層 | 技術 |
|---|---|
| Backend | Node.js 22 / Express / `node:sqlite`（外部DB依存なし） |
| Frontend | React 19 / Vite / TypeScript strict / Tailwind v3 |
| Test | `node:test` (built-in) |

## 開発

```powershell
# backend (ターミナル A)
cd video-vault\backend
npm install
npm run dev

# frontend (ターミナル B)
cd video-vault\frontend
npm install
npm run dev
```
