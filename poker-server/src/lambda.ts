import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { registerRoutes } from "./api/routes.js";
// 型は最小限でOK（v1/v2混在を吸収）
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import type { Response as LmrResponse } from "light-my-request";

// ファイル先頭付近（ビルド識別用）
console.log("BUILD_TAG=2025-11-09T11:xx+09:00");

// 先頭付近に追加（環境変数で上書きも可能に）
const APP_PREFIX = process.env.APP_PREFIX ?? "/d27";

let appPromise: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    const app = Fastify();
    appPromise = (async () => {
      await app.register(cors);
      
      // ✅ デバッグ用の直書きルート（/hello）
      app.get("/hello", async () => ({ ok: true }));

      // 既存アプリのルート登録
      await registerRoutes(app);

      // ✅ ルート一覧をログ（CloudWatchに出ます）
      await app.ready();
      console.log(app.printRoutes());

      return app;
    })();
  }
  return appPromise;
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://d21iyt3tejfu9r.cloudfront.net",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  Vary: "Origin",
};

// v1/v2 を正規化（抜粋）
function normalizeRequest(event: any) {
    const isV2 = event?.version === "2.0" || !!event?.requestContext?.http;
  
    const methodRaw: string = isV2
      ? event?.requestContext?.http?.method ?? "GET"
      : event?.httpMethod ?? "GET";
  
    // 1) パス取得
    let rawPath: string = isV2 ? (event?.rawPath ?? "/") : (event?.path ?? "/");
    if (!rawPath.startsWith("/")) rawPath = "/" + rawPath;

    // ← 追加：API GWの実ステージ（HTTP APIは既定で "$default"）
    const stage: string | undefined = event?.requestContext?.stage;

    // 2) 先頭のステージ名、CF Origin Path（/d27 等）、/api を“何度でも”剥がす
    const STAGE_PREFIX = stage ? `/${stage}` : undefined;
    const EXTRA_PREFIXES = ["/d27"]; // ← ここに必要な先頭プレフィックスを列挙（増やしてOK）

    let changed = true;
    while (changed) {
    changed = false;

    // a) /{stage} を剥がす（例: "$default"）
    if (STAGE_PREFIX && rawPath === STAGE_PREFIX) { rawPath = "/"; changed = true; }
    else if (STAGE_PREFIX && rawPath.startsWith(STAGE_PREFIX + "/")) { rawPath = rawPath.slice(STAGE_PREFIX.length); changed = true; }

    // b) 追加プレフィックス（例: /d27）を剥がす
    for (const p of EXTRA_PREFIXES) {
        if (rawPath === p) { rawPath = "/"; changed = true; }
        else if (rawPath.startsWith(p + "/")) { rawPath = rawPath.slice(p.length); changed = true; }
    }

    // c) /api を剥がす
    if (rawPath === "/api") { rawPath = "/"; changed = true; }
    else if (rawPath.startsWith("/api/")) { rawPath = rawPath.slice(4); changed = true; } // "/api".length === 4
    }

    // 3) 必ず素通しするパス（必要に応じて追加）
    const KEEP_AS_IS = new Set<string>(["/hello"]);
    const keep = KEEP_AS_IS.has(rawPath);

    // 4) 素通し以外は /d27 を付与（Fastifyのルートが /d27/... なので合わせる）
    const APP_PREFIX = process.env.APP_PREFIX ?? "/d27";
    if (!keep && !rawPath.startsWith(APP_PREFIX + "/") && rawPath !== APP_PREFIX) {
    rawPath = APP_PREFIX + (rawPath === "/" ? "" : rawPath);
    }
  
    // 5) クエリ結合
    const rawQuery = isV2
      ? (event?.rawQueryString ?? "")
      : (() => {
          const q = event?.queryStringParameters as Record<string, string> | null;
          if (!q || !Object.keys(q).length) return "";
          return Object.entries(q)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`)
            .join("&");
        })();
    const url = rawQuery ? `${rawPath}?${rawQuery}` : rawPath;
  
    // 6) Body/base64
    let payload: any = event?.body ?? undefined;
    if (payload && event?.isBase64Encoded) {
      payload = Buffer.from(payload, "base64").toString("utf8");
    }
  
    // 7) ヘッダ正規化
    const headers =
      (event?.headers
        ? Object.fromEntries(
            Object.entries(event.headers as Record<string, unknown>).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(", ") : String(v ?? ""),
            ])
          )
        : undefined) as Record<string, string> | undefined;
  
    const method = (methodRaw || "GET").toUpperCase() as
      | "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
  
    return { method, url, payload, headers };
  }


function normalizeHeaders(
  h: Record<string, unknown> | undefined
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!h) return out;
  for (const [k, v] of Object.entries(h)) {
    if (v == null) continue;
    if (Array.isArray(v)) out[k] = v.join(", ");
    else if (typeof v === "object") out[k] = String(v);
    else out[k] = v as string | number | boolean;
  }
  return out;
}

export const handler: APIGatewayProxyHandlerV2 = async (event: any) => {
    try {
    console.log("REQ_START", JSON.stringify({
        awsRequestId: (event?.requestContext?.requestId || "n/a"),
        stage: event?.requestContext?.stage,
        rawPath: event?.rawPath ?? event?.path ?? "",
        httpMethod: event?.requestContext?.http?.method ?? event?.httpMethod ?? ""
        }));
        
      const app = await getApp();
  
      console.log("NORMALIZE_BEFORE", event?.rawPath ?? event?.path ?? "");

      const { method, url, payload, headers } = normalizeRequest(event);
  
      // ★ これで CloudWatch に最終的に叩いているURLが出ます
      console.log(
        JSON.stringify({
          stage: event?.requestContext?.stage,
          method,
          url,
        })
      );
  
      console.log("INJECT", JSON.stringify({ method, url }));
      const res: LmrResponse = await app.inject({ method, url, payload, headers });
      console.log("RES", JSON.stringify({ statusCode: res.statusCode }));
  
      const mergedHeaders = { ...normalizeHeaders(res.headers), ...corsHeaders };
      if (!("Content-Type" in mergedHeaders) && (res.headers as any)["content-type"]) {
        mergedHeaders["Content-Type"] = String((res.headers as any)["content-type"]);
      }

      // ★ ここを追加：正規化の結果と入力を“見える化”
      mergedHeaders["X-Debug-Normalized-Url"] = url;
      // v2 なら rawPath、v1 なら path を素直に拾う
      mergedHeaders["X-Debug-RawPath"] = String(event?.rawPath ?? event?.path ?? ""); 
       
      return {
        statusCode: res.statusCode,
        headers: mergedHeaders,
        body: typeof res.payload === "string" ? res.payload : JSON.stringify(res.payload),
      };
    } catch (err: any) {
      console.error("handler error", err?.stack || err?.message || err);
      return {
        statusCode: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "lambda-failed", message: String(err?.message || err) }),
      };
    }
  };