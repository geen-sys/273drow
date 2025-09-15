import { Card } from "../model/types.js";

// TODO: 高速化は後で（WASM/C実装を入れ替え可能に）
// ここではショーダウンの順位付けの「器」を用意
export function rank5of7(hand: [Card,Card], board: Card[]): number {
  // 仮実装：実際は 7枚→最強5枚の辞書順/ビットマスク判定
  // 返値：大きいほど強い。等しければタイ扱い。
  return Math.random(); // ダミー
}
