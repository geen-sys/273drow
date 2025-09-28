import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./api/routes.js";
import * as dotenv from "dotenv";
dotenv.config();

const app = Fastify({ logger: true });
registerRoutes(app);

await app.register(cors, {
    origin: ["http://localhost:5173", "http://localhost:4173"], // 開発フロントのオリジン
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,                 // プリフライトを1日キャッシュ
    // credentials: true, // Cookie等を使うなら有効化＆originはワイルドカード不可
  });

const port = Number(process.env.PORT ?? 8787);
app.listen({ host: "0.0.0.0", port }).then(() => {
    console.log(`Server listening at http://0.0.0.0:${port}`);
});
  