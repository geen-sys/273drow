import { Card } from "../model/types.js";

const RANKS = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"] as const;
const SUITS = ["h","d","c","s"] as const;

export function freshDeck(): Card[] {
  const d: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) d.push(`${r}${s}` as Card);
  return d;
}

export function shuffle(deck: Card[], rng = Math.random): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
