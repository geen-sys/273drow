import { FastifyInstance } from "fastify";
import { Card } from "../model/types.js";
import { z, ZodType } from "zod";

// （必要ならNLHEのGameもimportできますが、ここでは2-7専用のみ）
import { TwoSevenGame } from "../engine/TwoSevenGame.js";
import { runAutoUntilP1 } from "../engine/AutoRunner27.js";

// "As", "Td", "7c" など1枚のカードを表すZodスキーマ
const CardSchema: ZodType<Card> = z.custom<Card>(
  (val) => typeof val === "string" && /^[2-9TJQKA][hdcs]$/.test(val),
  { message: "invalid card string (expected like 'As','Td','7c')" }
);

export function registerRoutes(app: FastifyInstance) {
  // ヘルスチェック
  app.get("/health", async () => ({ ok: true }));

  // ===== 2–7 Triple Draw エンドポイント =====

  app.post("/d27/table/new", async (req, rep) => {
    try {
      // Bodyが空でもOKにするなら {} を許容
      const body = (req.headers["content-type"]?.includes("application/json") && req.body) ? req.body : {};
      const tableId = TwoSevenGame.createTable({}); // あなたの作り方に合わせて
      return rep.send({ tableId });
    } catch (e: any) {
      return rep.status(500).send({ message: e?.message || "new table failed" });
    }
  });
  
  app.post("/d27/hand/deal", async (req, rep) => {
    try {
      const body = z.object({ tableId: z.string() }).parse(req.body);
      const out = TwoSevenGame.deal(body.tableId);
      return rep.send(out.publicState ?? out); // 実装に合わせて
    } catch (e: any) {
      const msg = e?.message || "deal failed";
      const status = /table|not found|parse/i.test(msg) ? 400 : 500;
      return rep.status(status).send({ message: msg });
    }
  });
  
  app.post("/d27/auto/run", async (req, rep) => {
    try {
      const body = z.object({ tableId: z.string() }).parse(req.body);
      runAutoUntilP1(body.tableId);
      const ps = TwoSevenGame.getPublicState(body.tableId, "p1");
      return rep.send(ps);
    } catch (e: any) {
      const msg = e?.message || "auto run failed";
      const status = /table|not found|parse/i.test(msg) ? 400 : 500;
      return rep.status(status).send({ message: msg });
    }
  });
  
  app.post("/d27/debug/round", async (req, rep) => {
    try {
      const body = z.object({ tableId: z.string() }).parse(req.body);
      const dbg = TwoSevenGame.getDebug(body.tableId); // 以前作ったやつ
      return rep.send(dbg);
    } catch (e: any) {
      const msg = e?.message || "debug failed";
      const status = /table|not found|parse/i.test(msg) ? 400 : 500;
      return rep.status(status).send({ message: msg });
    }
  });
  
  // ベットアクション（fold/check/call/bet/raise）
  // ※ p1 が行動した直後に、裏で p2〜p6 を自動進行して「次に p1 の番」まで回します
  app.post("/d27/hand/action", async (req, rep) => {
    const body = z.object({
      tableId: z.string(),
      playerId: z.string(),
      action: z.enum(["fold","check","call","bet","raise"])
    }).parse(req.body);

    TwoSevenGame.action(body.tableId, body.playerId, body.action);
    if (body.playerId === "p1") {
      runAutoUntilP1(body.tableId);
    }
    const state = TwoSevenGame.getPublicState(body.tableId, "p1");
    return rep.send(state);
  });

  // ドロー（0〜3枚捨て）
  // ※ p1 のドロー直後に、裏で p2〜p6 も自動ドロー＆次ベットを p1 の番まで進めます
  app.post("/d27/hand/draw", async (req, rep) => {
    try {
      const body = z.object({
        tableId: z.string(),
        playerId: z.string(),
        discard: z.array(CardSchema)  // あなたのカード型に合わせて
      }).parse(req.body);
  
      const out = TwoSevenGame.draw(body.tableId, body.playerId, body.discard);
      return rep.send(out.publicState);
    } catch (e: any) {
      const msg = e?.message || "draw failed";
      const status = (msg === "not draw phase" || msg === "not your turn" || msg === "no draws remaining" || msg === "max 3 discards")
        ? 400 : 500;
      return rep.status(status).send({ message: msg });
    }
  });
  
  
  // 任意のタイミングでショーダウン（結果を返す）
  app.post("/d27/showdown", async (req, rep) => {
    const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
    const result = TwoSevenGame.showdown(tableId);
    return rep.send(result);
  });

  
  // // （オプション）p1の番まで強制的に自動で前進させるユーティリティ
  // app.post("/d27/auto/run", async (req, rep) => {
  //   const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
  //   runAutoUntilP1(tableId);
  //   const state = TwoSevenGame.getPublicState(tableId, "p1");
  //   return rep.send(state);
  // });
  
  app.post("/d27/state", async (req, rep) => {
    const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
    return rep.send(TwoSevenGame.getPublicState(tableId, "p1"));
  });

  app.post("/d27/hand/new", async (req, rep) => {
    const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
    const out = TwoSevenGame.deal(tableId);
    return rep.send(out.publicState);
  });

}
