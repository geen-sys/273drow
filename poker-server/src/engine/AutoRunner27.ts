import { Card, DrawTableState } from "../model/types.js";
import { TwoSevenGame } from "./TwoSevenGame.js";
import { chooseDiscards27, decideAction27 } from "./AutoBot27.js";

const isBot = (seatId: string) => seatId !== "p1";
const MAX_BOT_RAISES_PER_ROUND = 1; // ※ いまは簡易に「ラウンド全体で1回」を global raises で代用

function toCall(state: DrawTableState, seatId: string): number {
  const need = state.round.currentBet - (state.round.committed[seatId] ?? 0);
  return Math.max(0, need);
}

export function runAutoUntilP1(tableId: string) {
  for (let steps = 0; steps < 200; steps++) {
    const st = TwoSevenGame._peek(tableId) as DrawTableState;

    // ★ ショウダウン到達なら即終了（フロントにショウダウンさせる）
    if (st.mode === "showdown") break;

    const cur = st.seats[st.current];
    if (!cur || !cur.inHand) {
      // 無効席なら（fold等）ターンはサーバ側の action/draw 内で進む想定。ここでは何もしないで次ループ。
      continue;
    }

    // ★ p1 の順番になったら即停止（フロント操作へバトンタッチ）
    if (cur.id === "p1") break;

    try {
      if (st.mode === "bet") {
        const hand = cur.hand as [Card, Card, Card, Card, Card];
        const bet = st.round.allowed.bet;
        const need = Math.max(0, st.round.currentBet - (st.round.committed[cur.id] ?? 0));

        let a = decideAction27({ hand, toCall: need, bet, street: st.round.street });

        // レイズはキャップと簡易ポリシーで制限
        const canRaiseByCap = st.round.currentBet > 0 && st.round.raises < st.config.cap;
        const canRaiseByPolicy = st.round.raises < MAX_BOT_RAISES_PER_ROUND;

        if (a === "raise" && !(canRaiseByCap && canRaiseByPolicy)) {
          a = (need === 0 ? "check" : "call");
        }
        if (a === "call" && need === 0) a = "check";

        try {
          TwoSevenGame.action(tableId, cur.id, a as any);
        } catch (e) {
          // フォールバック：失敗したら安全側で進める
          const fallback = need === 0 ? "check" : "call";
          try { TwoSevenGame.action(tableId, cur.id, fallback as any); } catch { /* 最終手段: 無視して次へ */ }
        }
        continue;
      }

      if (st.mode === "draw") {
        const discard = chooseDiscards27(st.seats[st.current].hand as Card[]);
        try {
          TwoSevenGame.draw(tableId, cur.id, discard);
        } catch (e) {
          // 例: "no draws remaining" 等 → 何もしなくても draw() 側でターンが進んでいるはず。進んでいなければ次ループで再判定。
        }
        continue;
      }

      // 予期しないモード → ループ終了（安全側）
      break;

    } catch {
      // 想定外の例外：ループを抜ける（無限ループ防止）
      break;
    }
  }
}
