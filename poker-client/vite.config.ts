// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "robots.txt", "apple-touch-icon.png"],
      manifest: {
        name: "2–7 Triple Draw",
        short_name: "2–7 Draw",
        description: "Deuce-to-Seven Triple Draw prototype",
        theme_color: "#111827",      // ツールバー色
        background_color: "#0b1220", // スプラッシュ背景
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "ja",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      // API をオフラインでも扱いやすくするためのキャッシュ戦略
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          // 静的アセット：キャッシュ優先
          {
            urlPattern: ({request}) => request.destination === "style" || request.destination === "script" || request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "assets" }
          },
          // ゲームAPI：最新優先（失敗時はキャッシュ）
          {
            urlPattern: /\/d27\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-d27",
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  server: {
    // 既に設定済みならそのまま。PWA自体とは独立です
    proxy: { "/d27": { target: "http://localhost:8787", changeOrigin: true } }
  }
});
