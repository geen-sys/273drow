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

  // 卓作成（座席数・リミットは必要に応じて変更可能）
  app.post("/d27/table/new", async (_req, rep) => {
    const id = TwoSevenGame.createTable({ seats: 6, smallBet: 1, bigBet: 2, cap: 8 }); // ← 4→8
    return rep.send({ tableId: id });
  });

  // 配札（各5枚）→ プレドロー・ベット開始（p1視点の公開状態を返す）
  app.post("/d27/hand/deal", async (req, rep) => {
    const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
    const out = TwoSevenGame.deal(tableId);
    return rep.send(out.publicState);
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
    const body = z.object({
      tableId: z.string(),
      playerId: z.string(),
      discard: z.array(CardSchema).max(3)   // ← string[] ではなく Card[] として受ける
    }).parse(req.body);
  
    // もう型は Card[] なので、そのまま渡せる
    TwoSevenGame.draw(body.tableId, body.playerId, body.discard);
  
    if (body.playerId === "p1") {
      runAutoUntilP1(body.tableId);
    }
    const state = TwoSevenGame.getPublicState(body.tableId, "p1");
    return rep.send(state);
  });
  
  // 任意のタイミングでショーダウン（結果を返す）
  app.post("/d27/showdown", async (req, rep) => {
    const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
    const result = TwoSevenGame.showdown(tableId);
    return rep.send(result);
  });

  // （オプション）p1の番まで強制的に自動で前進させるユーティリティ
  app.post("/d27/auto/run", async (req, rep) => {
    const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
    runAutoUntilP1(tableId);
    const state = TwoSevenGame.getPublicState(tableId, "p1");
    return rep.send(state);
  });

  app.post("/d27/debug/round", async (req, rep) => {
    const { tableId } = z.object({ tableId: z.string() }).parse(req.body);
    // @ts-ignore 内部参照
    const t = TwoSevenGame._peek(tableId);
    return rep.send({
      street: t.round.street,
      pot: t.round.pot,
      currentBet: t.round.currentBet,
      raises: t.round.raises,
      cap: t.config.cap,
      committed: t.round.committed,
      currentSeat: t.seats[t.current]?.id
    });
  });
  
  
}
