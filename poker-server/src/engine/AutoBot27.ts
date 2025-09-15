import { Card, DrawSeat, DrawTableState, DrawPublicState, LowballAction, DrawStreet } from "../model/types.js";
import { key27 } from "./TwoSevenEval.js";

const HI = new Map([["A",13],["K",12],["Q",11],["J",10],["T",9],["9",8],["8",7],["7",6],["6",5],["5",4],["4",3],["3",2],["2",1]]);

function ranks(hand: Card[]){ return hand.map(c=>c[0]); }
function suits(hand: Card[]){ return hand.map(c=>c[1]); }

function hasPair(hand: Card[]){
  const m = new Map<string,number>();
  for (const r of ranks(hand)) m.set(r,(m.get(r)||0)+1);
  for (const v of m.values()) if (v>1) return true;
  return false;
}

function straightRisk(hand: Card[]){
  // 連番が4枚以上ならストレートリスク高（超簡易）
  const arr = Array.from(new Set(ranks(hand))).map(r=>HI.get(r)!)
              .sort((a,b)=>a-b);
  let best = 1, cur = 1;
  for (let i=1;i<arr.length;i++){
    if (arr[i] === arr[i-1]+1) { cur++; best=Math.max(best,cur); }
    else cur=1;
  }
  return best >= 4;
}
function flushRisk(hand: Card[]){
  const m = new Map<string,number>();
  for (const s of suits(hand)) m.set(s,(m.get(s)||0)+1);
  return Array.from(m.values()).some(v=>v>=4);
}

/** 0〜3枚の捨て札を選ぶ（簡易方針） */
export function chooseDiscards27(hand: Card[]): Card[] {
  let h = [...hand];
  const discards: Card[] = [];
  const push = (c: Card) => { if (discards.length<3) { discards.push(c); h.splice(h.indexOf(c),1); } };

  // 1) ペアがあれば“高い方”から崩す
  const cnt = new Map<string, Card[]>();
  for (const c of hand){ const r=c[0]; (cnt.get(r)??cnt.set(r,[]).get(r)!).push(c); }
  const pairs = Array.from(cnt.entries()).filter(([,cs])=>cs.length>1)
                    .sort((a,b)=>HI.get(b[0])!-HI.get(a[0])!);
  for (const [,cs] of pairs){
    for (let i=cs.length-1;i>=1;i--) push(cs[i]); // 2枚目以降を捨てる
    if (discards.length>=3) return discards;
  }

  // 2) ハイカード処理（A,K,Q,J,Tの順に切る）
  const highOrder = ["A","K","Q","J","T","9","8"];
  for (const hr of highOrder){
    const idx = h.findIndex(c=>c[0]===hr);
    if (idx>=0) push(h[idx]);
    if (discards.length>=3) return discards;
  }

  // 3) ストレート/フラッシュリスク緩和：最も高いランク/被りスーツを落とす
  if (straightRisk(h) || flushRisk(h)){
    // 一番ハイのカードを落とす
    let worst = h[0];
    for (const c of h) if (HI.get(c[0])! > HI.get(worst[0])!) worst = c;
    push(worst);
  }

  return discards;
}

/** スコアは小さいほど強い（TwoSevenEval.key27ベース） */
export function score27(hand: [Card,Card,Card,Card,Card]): number {
  const k = key27(hand);
  return k[0]*120 + k.slice(1).reduce((s,x)=>s+x,0); // badの重みを少し増やす
}

/** ベッティング意思決定（limit）。raisesSoFar を考慮して攻撃性を下げる */
export function decideAction27(opts: {
  hand: [Card,Card,Card,Card,Card];
  toCall: number;
  bet: number;
  street: "pre"|"post1"|"post2"|"post3";
  raisesSoFar?: number;
}): "check"|"call"|"bet"|"raise"|"fold" {
  const s = score27(opts.hand);

  // ざっくり基準（数値は後で調整可）
  const VERY_STRONG = 130;
  const STRONG      = 170;
  const OK          = 215;

  const cheap = opts.toCall <= opts.bet;
  const raises = opts.raisesSoFar ?? 0;

  // ラウンドが進むほど（post2, post3）はややタイトに
  const tighten = opts.street === "post3" ? 10 : opts.street === "post2" ? 5 : 0;

  if (opts.toCall === 0) {
    // 誰もベットしていない → ベットは「かなり強い時のみ」
    if (s < VERY_STRONG - tighten) return "bet";
    return "check";
  } else {
    // 既にベットがある
    if (s < VERY_STRONG - tighten) {
      // ただしレイズ乱発を抑制：既に1回以上レイズが出ていたら原則コール
      if (raises === 0) return "raise";
      return cheap ? "call" : "fold";
    }
    if (s < STRONG - tighten) return cheap ? "call" : "fold";
    if (s < OK - tighten)     return cheap ? "call" : "fold";
    return "fold";
  }
}
