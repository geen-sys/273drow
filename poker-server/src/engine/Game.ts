import { freshDeck, shuffle } from "./Deck.js";
import { PublicState, TableState, Action } from "../model/types.js";
import { validateAction, nextStreet } from "./Rules.js";
import { randomId } from "../utils/random.js";

const tables = new Map<string, TableState>();

function initRound(t: TableState, street: "pre"|"flop"|"turn"|"river") {
  t.round = {
    street,
    pot: t.round?.pot ?? 0,
    allowedSizes: street === "pre" ? [2, "allin"] : [0.33, 0.66, 1.0, "allin"],
    history: [],
    currentBet: street === "pre" ? 2 : 0,                // 雛形：preは2BB相当を仮置き
    committed: Object.fromEntries(t.seats.map(s => [s.id, 0]))
  };
}

function getToCall(t: TableState, seatId: string): number {
  const need = t.round.currentBet - (t.round.committed[seatId] ?? 0);
  return Math.max(0, need);
}

function isBettingComplete(t: TableState): boolean {
  const alive = t.seats.filter(s => s.inHand);
  return alive.every(s => getToCall(t, s.id) === 0);
}

function advanceStreet(t: TableState) {
  nextStreet(t);
  const next =
    t.board.length === 0 ? "pre" :
    t.board.length === 3 ? "flop" :
    t.board.length === 4 ? "turn" : "river";
  initRound(t, next);
}

export const Game = {
  createTable({ seats = 6 }: { seats?: number }) {
    const id = randomId("tbl_");
    const seatObjs = Array.from({ length: seats }, (_, i) => ({
      id: `p${i+1}`, stack: 100, inHand: true
    }));
    const t: TableState = {
      id,
      seats: seatObjs,
      deck: [], board: [],
      current: 0,
      round: { street:"pre", pot: 0, allowedSizes:[2,"allin"], history: [], currentBet: 2, committed: {} as any }
    };
    t.round.committed = Object.fromEntries(seatObjs.map(s => [s.id, 0]));
    tables.set(id, t);
    return id;
  },

  deal(tableId: string) {
    const t = mustTable(tableId);
    t.deck = shuffle(freshDeck());
    t.board = [];
    t.seats.forEach(s => { s.inHand = true; (s as any).hand = [t.deck.pop()!, t.deck.pop()!]; });
    initRound(t, "pre");
    t.current = 0;
    return { publicState: toPublic(t, t.seats[0].id) };
  },

  applyAction(tableId: string, playerId: string, action: Action, size?: number|"allin") {
    const t = mustTable(tableId);
    validateAction(t, action, size);

    const seat = t.seats[t.current];
    if (seat.id !== playerId) throw new Error("not your turn");

    if (action === "fold") {
      seat.inHand = false;
    } else if (action === "check") {
      if (getToCall(t, seat.id) > 0) throw new Error("cannot check when facing a bet");
      // 何もしない
    } else if (action === "call") {
      const amt = getToCall(t, seat.id);
      if (amt <= 0) throw new Error("nothing to call");
      t.round.committed[seat.id] += amt;
      t.round.pot += amt;
    } else if (action === "raise") {
      const raiseTo = Number(size) || 0;                 // “raise to” として解釈
      if (raiseTo <= t.round.currentBet) throw new Error("raise must exceed current bet");
      const need = raiseTo - (t.round.committed[seat.id] ?? 0);
      if (need <= 0) throw new Error("nothing to add");
      t.round.committed[seat.id] += need;
      t.round.pot += need;
      t.round.currentBet = raiseTo;
    }

    t.round.history.push({ seatId: seat.id, a: action, size });
    t.current = (t.current + 1) % t.seats.length;

    // ベット完了（生存者全員がcurrentBetに到達）で次ストリートへ
    if (isBettingComplete(t)) {
      if (t.round.street === "river") {
        // TODO: ショーダウン実装
      } else {
        advanceStreet(t);
      }
    }
    return { publicState: toPublic(t, playerId) };
  },

  getPublicState(tableId: string, heroId: string) {
    const t = mustTable(tableId);
    return toPublic(t, heroId);
  }
};

function toPublic(t: TableState, heroId: string): PublicState {
  return {
    tableId: t.id,
    heroSeatId: heroId,
    heroHand: t.seats.find(s => s.id === heroId)?.hand as any,
    board: t.board,
    stacks: Object.fromEntries(t.seats.map(s => [s.id, s.stack])),
    pot: t.round.pot,
    toCall: getToCall(t, heroId),
    allowedSizes: t.round.allowedSizes,
    street: t.round.street,
    actionHistory: t.round.history
  };
}

function mustTable(id: string): TableState {
  const t = tables.get(id);
  if (!t) throw new Error("table not found");
  return t;
}
