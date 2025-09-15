import { Action, TableState } from "../model/types.js";

export function validateAction(state: TableState, action: Action, size?: number|"allin") {
  const allowed = state.round.allowedSizes;

  if (action === "raise") {
    if (size === undefined) throw new Error("raise size required");
    if (!allowed.some(a => a === size)) throw new Error("illegal size");
  } else if (action === "call") {
    // 実際の toCall 判定は Game 側で seatId を使って行う（ここではサイズ系のみ確認）
  } else if (action === "check") {
    // checkは「呼ぶ額が0」のときのみ（最終判定はGame側）
  } else if (action === "fold") {
    // 常に可（特別な検証なし）
  }
}

// ボード配布（burnなどは雛形では省略）
export function nextStreet(state: TableState) {
  const b = state.board;
  if (b.length === 0) state.board = [state.deck.pop()!, state.deck.pop()!, state.deck.pop()!];
  else if (b.length === 3) state.board.push(state.deck.pop()!);
  else if (b.length === 4) state.board.push(state.deck.pop()!);
}
