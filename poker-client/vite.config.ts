// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'pwa-512-maskable.png'
      ],
      manifest: {
        name: 'Poker 27',
        short_name: 'Poker27',
        description: 'Deuce-to-Seven Triple Draw Poker (PWA Demo)',
        theme_color: '#0d6efd',
        icons: [
          {
            src: 'pwa-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  server: {
    host: true,              // ← LAN公開
    port: 5173,
    proxy: {
      // /d27 はバックエンドへ転送（ViteがMac上で動くので targetはlocalhostでOK）
      "/d27": {
        target: "http://localhost:8787",
        changeOrigin: true,
        // 必要なら：ヘッダ調整
        // configure: (proxy) => { proxy.on('proxyReq', ...); }
      },
    },
  },
});
