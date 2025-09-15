import Fastify from "fastify";
import { registerRoutes } from "./api/routes.js";
import * as dotenv from "dotenv";
dotenv.config();

const app = Fastify({ logger: true });
registerRoutes(app);

const port = Number(process.env.PORT ?? 8787);
app.listen({ port, host: "0.0.0.0" });
