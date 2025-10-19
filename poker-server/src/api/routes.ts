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

  app.post("/d27/table/new", async (req, reply) => {
    // body: { seats?: number }
    const body = (req.body ?? {}) as { seats?: number };
    const tableId = TwoSevenGame.createTable({ seats: body.seats ?? 4 }); // ★デフォルト4人
    reply.send({ tableId });
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
  
  app.post("/d27/auto/run", async (req, reply) => {
    const { tableId } = req.body as { tableId: string };
  
    let guard = 0;
    let lastKey = "";
  
    // 状態が進む限り繰り返し、p1 の手番/ショウダウンで抜ける
    while (guard++ < 200) {
      const st = TwoSevenGame._peek(tableId);
      if (!st) break;
  
      // 進捗キー（同一なら停滞）
      const key =
        `${st.mode}|${st.round.street}|${st.current}|${st.round.raises}|${st.round.currentBet}|` +
        Object.values(st.round.committed || {}).join(",");
  
      if (key === lastKey) break;
      lastKey = key;
  
      // ショウダウンなら終了
      if (st.mode === "showdown") break;
  
      // p1 の手番に到達 → ベットフェーズなら必要に応じて自動コール
      const curSeat = st.seats[st.current];
      if (curSeat?.id === "p1") {
        if (st.mode === "bet") {
          const need = st.round.currentBet - (st.round.committed?.["p1"] ?? 0);
          if (need > 0) {
            // コールが必要なら一括自動コール（あなたの実装の autoCall を使用）
            TwoSevenGame.autoCall(tableId);
            // ここでドローフェーズに遷移する実装なら、一旦抜けてフロントに返す
          }
        }
        break; // p1 の手番に来たので終了（フロントで表示/操作）
      }
  
      // まだ p1 手番じゃない/相手が続く → ランナーで前に進める
      runAutoUntilP1(tableId);
    }
  
    const ps = TwoSevenGame.getPublicState(tableId, "p1");
    reply.send(ps);
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
  app.post("/d27/showdown", async (req, reply) => {
    const body = req.body as { tableId: string };
    const result = TwoSevenGame.showdown(body.tableId);
  
    // t を覗けるヘルパ（あなたの既存コードに合わせて取得）
    const t = TwoSevenGame._peek(body.tableId);
  
    // 全員の手札（ショウダウン時のみ）
    const hands = Object.fromEntries(
      t.seats.map((s: any) => [s.id, s.hand]) // hand: ["As","Kd",...]
    );
  
    // 既存の result に hands を足して返す
    reply.send({ ...result, hands });
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
