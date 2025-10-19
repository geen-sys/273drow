// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "pwa-192.png",
        "pwa-512.png",
        "pwa-512-maskable.png",
      ],
      manifest: {
        name: "Poker 27",
        short_name: "Poker27",
        description: "Deuce-to-Seven Triple Draw Poker (PWA Demo)",
        theme_color: "#0d6efd",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],

  // 開発サーバ（vite dev）
  server: {
    host: true,
    port: 5173, // ← dev時のポート（必要に応じて）
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      "*.trycloudflare.com", // devで使う場合に備えて
    ],
    proxy: {
      "/d27": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },

  // プレビューサーバ（vite preview）← 今回はここが重要！
  preview: {
    host: true,
    port: 4173, // あなたが preview で使っているポート
    // allowedHosts: true, // ← これで全ホスト許可（検証用）
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      // // 毎回変わる CF のURLを許可する（ワイルドカードが効かない場合は都度追加）
      // "*.trycloudflare.com",
      // 問題になった実ホストを念のため明示
      "cyber-cabinets-examining-formation.trycloudflare.com",
    ],
  },
});