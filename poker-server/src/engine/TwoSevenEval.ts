import { Card } from "../model/types.js";

// ランク昇順（2が最良、Aが最悪）
const ORDER = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"] as const;
const RANK = Object.fromEntries(ORDER.map((r,i)=>[r,i])) as Record<string,number>;

function ranks(hand: Card[]) { return hand.map(c=>c[0]); }
function suits(hand: Card[]) { return hand.map(c=>c[1]); }

function isFlush(hand: Card[]) {
  const s = suits(hand);
  return s.every(x=>x===s[0]);
}
function isStraight(hand: Card[]) {
  const idxs = ranks(hand).map(r=>RANK[r]).sort((a,b)=>a-b);
  for (let i=1;i<idxs.length;i++) if (idxs[i]!==idxs[0]+i) return false;
  return true;
}
function hasPairOrMore(hand: Card[]) {
  const cnt: Record<string,number> = {};
  for (const r of ranks(hand)) cnt[r]=(cnt[r]??0)+1;
  return Object.values(cnt).some(v=>v>1);
}

/** 2-7ローボール用、強さキーを返す（小さいほど強い） */
export function key27(hand: [Card,Card,Card,Card,Card]): number[] {
  const arr = [...hand];
  // 2–7ではストレート・フラッシュ・ペアは“悪い”
  const bad = (isStraight(arr) ? 1:0) + (isFlush(arr)?1:0) + (hasPairOrMore(arr)?1:0);
  // ランク弱い順（2,3,4,5,6…A）で並べる
  const idxs = ranks(arr).map(r=>RANK[r]).sort((a,b)=>a-b);
  // 比較は [badフラグ, 最高ハイカード, 次ハイ…] の辞書順
  return [bad, ...idxs.reverse()]; // badが少ないほど強い。次に“ハイカードが弱いほど強い”のでreverse
}

/** aがbより強ければ -1、同等 0、弱ければ +1 */
export function cmp27(a: [Card,Card,Card,Card,Card], b: [Card,Card,Card,Card,Card]): number {
  const ka = key27(a), kb = key27(b);
  const n = Math.max(ka.length, kb.length);
  for (let i=0;i<n;i++){
    const da = ka[i]??0, db = kb[i]??0;
    if (da<db) return -1;
    if (da>db) return +1;
  }
  return 0;
}
