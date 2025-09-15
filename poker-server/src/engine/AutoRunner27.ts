import { Card, DrawTableState } from "../model/types.js";
import { TwoSevenGame } from "./TwoSevenGame.js";
import { chooseDiscards27, decideAction27 } from "./AutoBot27.js";

const isBot = (seatId: string) => seatId !== "p1";
const MAX_BOT_RAISES_PER_ROUND = 1; // ★ これを追加：ラウンド中、Bot全体で最大1回まで

function toCall(state: DrawTableState, seatId: string): number {
  const need = state.round.currentBet - (state.round.committed[seatId] ?? 0);
  return Math.max(0, need);
}
function everyoneMatched(state: DrawTableState): boolean {
  const alive = state.seats.filter((s) => s.inHand);
  return alive.every((s) => toCall(state, s.id) === 0);
}
function inBetPhase(state: DrawTableState): boolean {
  return !everyoneMatched(state);
}
function inDrawPhase(state: DrawTableState): boolean {
  return everyoneMatched(state);
}

export function runAutoUntilP1(tableId: string) {
  for (let steps = 0; steps < 200; steps++) {
    const st = TwoSevenGame._peek(tableId) as DrawTableState;
    const cur = st.seats[st.current];

    // ★ p1 の順番になったら即停止（重複入力を避ける）
    if (!cur || !cur.inHand || cur.id === "p1") break;

    try {
      if (st.mode === "bet") {
        const hand = cur.hand as [Card,Card,Card,Card,Card];
        const bet = st.round.allowed.bet;
        const need = Math.max(0, st.round.currentBet - (st.round.committed[cur.id] ?? 0));

        let a = decideAction27({ hand, toCall: need, bet, street: st.round.street });
        const canRaiseByCap = st.round.currentBet > 0 && st.round.raises < st.config.cap;
        const canRaiseByPolicy = st.round.raises < 1;  // ラウンド中 Bot は1レイズまで（簡易）
        if (a === "raise" && !(canRaiseByCap && canRaiseByPolicy)) a = (need === 0 ? "check" : "call");
        if (a === "call" && need === 0) a = "check";

        TwoSevenGame.action(tableId, cur.id, a as any);
        continue;
      }

      if (st.mode === "draw") {
        const discard = chooseDiscards27(st.seats[st.current].hand as Card[]);
        TwoSevenGame.draw(tableId, cur.id, discard);
        continue;
      }

      break;
    } catch {
      break;
    }
  }
}

