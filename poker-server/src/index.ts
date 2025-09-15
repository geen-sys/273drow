import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./api/routes.js";
import * as dotenv from "dotenv";
dotenv.config();

const app = Fastify({ logger: true });
registerRoutes(app);

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" });

await app.register(cors, {
    origin: ["http://localhost:5173"], // 開発フロントのオリジン
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    // credentials: true, // Cookie等を使うなら有効化＆originはワイルドカード不可
  });