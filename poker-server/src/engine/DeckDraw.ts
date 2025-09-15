import { Card } from "../model/types.js";
import { freshDeck, shuffle } from "./Deck.js";

export function drawFromDeck(state: { deck: Card[]; discards: Card[] }, n: number): Card[] {
  const out: Card[] = [];
  for (let i=0;i<n;i++){
    if (state.deck.length===0) {
      // 山が尽きたら捨て札から補充（簡易：全捨て札でリシャッフル）
      state.deck = shuffle(state.discards);
      state.discards = [];
    }
    out.push(state.deck.pop()!);
  }
  return out;
}
