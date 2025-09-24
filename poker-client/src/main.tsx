// main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./App.css";

// ★ 追加：vite-plugin-pwa が生成する仮想モジュール
import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true }); // 新SWが来たら自動で更新

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
