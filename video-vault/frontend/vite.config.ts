import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 開発サーバーの待ち受け設定。
 * - LAN や Tailscale 経由でスマホから見る場合は VITE_HOST=0.0.0.0 で起動するか
 *   `npm run dev -- --host 0.0.0.0` を使う
 * - /api は backend (3001) にプロキシ
 * - Tailscale Funnel など外部 URL からのアクセスを許可するため
 *   allowedHosts に `.ts.net` のサブドメインを許可しておく
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST || '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Vite 5+ は dev で host header をチェックする。Tailscale 経由のアクセスを通す。
    allowedHosts: ['.ts.net', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
