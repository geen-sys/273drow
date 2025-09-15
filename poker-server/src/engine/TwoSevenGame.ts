import {
    Card,
    DrawPublicState,
    DrawTableState,
    LowballAction,
    DrawStreet,
  } from "../model/types.js";
  import { freshDeck, shuffle } from "./Deck.js";
  import { drawFromDeck } from "./DeckDraw.js";
  import { cmp27 } from "./TwoSevenEval.js";
  import { randomId } from "../utils/random.js";
  
  // テーブル管理（メモリ上）
  const tables = new Map<string, DrawTableState>();
  
  /** ベットラウンド初期化（limit: small/big を street から選ぶ） */
  // 新: pre のときは完全リセット、post 以降は pot を持ち越す
  function initBetRound(t: DrawTableState, street: DrawStreet) {
    const bet = (street === "pre" || street === "post1") ? t.config.smallBet : t.config.bigBet;
    const carryPot = (street === "pre") ? 0 : (t.round?.pot ?? 0); // pre は pot をリセット
  
    t.round = {
      street,
      pot: carryPot,
      allowed: { kind: "limit", bet },
      history: [],
      currentBet: 0,
      committed: Object.fromEntries(t.seats.map(s => [s.id, 0])),
      raises: 0, // ラウンド開始時は 0
    };
  }

  /** 現プレイヤーがコールに必要な額 */
  function toCall(t: DrawTableState, seatId: string): number {
    const need = t.round.currentBet - (t.round.committed[seatId] ?? 0);
    return Math.max(0, need);
  }
  
  /** 生存者全員が currentBet に到達しているか（= 追加で呼ぶ額がない） */
  function everyoneMatched(t: DrawTableState) {
    const alive = t.seats.filter((s) => s.inHand);
    return alive.every((s) => toCall(t, s.id) === 0);
  }
  
  /** 手番を次に進める（フォールド席はスキップ） */
  function advanceTurn(t: DrawTableState) {
    let next = (t.current + 1) % t.seats.length;
    for (let guard = 0; guard < t.seats.length; guard++) {
      if (t.seats[next].inHand) break;
      next = (next + 1) % t.seats.length;
    }
    t.current = next;
  }
  
  /** ドロー完了判定（簡易）：座席が一巡したらドロー完了とみなす */
  function allDrewThisPhase(t: DrawTableState) {
    // 厳密には「このフェーズで各プレイヤーが一度 draw したか」を履歴で見るのが本筋。
    // 雛形では「一巡」でOK。
    return t.current === 0;
  }
  
  /** ドロー後の次ストリート */
  function nextStreetAfterDraw(s: DrawStreet): DrawStreet | null {
    if (s === "pre") return "post1";
    if (s === "post1") return "post2";
    if (s === "post2") return "post3";
    return null;
  }
  
  /** p1視点の公開状態 */
  function pub(t: DrawTableState, heroId: string): DrawPublicState {
    return {
      tableId: t.id,
      heroSeatId: heroId,
      heroHand: t.seats.find((s) => s.id === heroId)?.hand as any,
      pot: t.round.pot,
      toCall: toCall(t, heroId),
      street: t.round.street,
      actionHistory: t.round.history,
    };
  }
  
  /** テーブル取得（存在しなければエラー） */
  function must(id: string): DrawTableState {
    const t = tables.get(id);
    if (!t) throw new Error("table not found");
    return t;
  }
  
  export const TwoSevenGame = {
    /** 卓を作る */
    // TwoSevenGame.ts

    createTable({ seats=6, smallBet=1, bigBet=2, cap=4 }: { seats?: number; smallBet?: number; bigBet?: number; cap?: number; }) {
      const id = randomId("td7_");
      const seatObjs = Array.from({ length: seats }, (_, i) => ({
        id: `p${i+1}`, stack: 100, inHand: true, drawsRemaining: 3,
      }));
    
      const t: DrawTableState = {
        id,
        seats: seatObjs as any,
        deck: [],
        discards: [],
        current: 0,
        config: { smallBet, bigBet, cap },
        round: undefined as any,
        mode: "bet",
        buttonIndex: 0,            // ★
        blinds: { smallBlind: 1, bigBlind: 2 }, // ★（必要なら /table/new で受け取る）
      };
      tables.set(id, t);
      return id;
    }
    ,

    /** 配札→プレドローベット開始 */
    deal(tableId: string) {
      const t = must(tableId);
      t.deck = shuffle(freshDeck());
      t.discards = [];
    
      for (const s of t.seats) {
        s.inHand = true;
        s.drawsRemaining = 3;
        (s as any).hand = drawFromDeck(t, 5) as [Card,Card,Card,Card,Card];
      }
    
      initBetRound(t, "pre");
      t.mode = "bet";
    
      // ★ SB/BB の座席（ボタンの左がSB、その左がBB）
      const sbIdx = (t.buttonIndex + 1) % t.seats.length;
      const bbIdx = (t.buttonIndex + 2) % t.seats.length;
      const sb = t.seats[sbIdx], bb = t.seats[bbIdx];
    
      // ★ コミット＆ポット反映（フォールド者は想定せず簡易）
      t.round.committed[sb.id] += t.blinds.smallBlind;
      t.round.committed[bb.id] += t.blinds.bigBlind;
      t.round.pot += t.blinds.smallBlind + t.blinds.bigBlind;
    
      // ★ 現在の要求額はビッグブラインド額（= これがコール額）
      t.round.currentBet = t.blinds.bigBlind;
    
      // ★ 最初に行動するのは BB の左（UTG）
      t.current = (bbIdx + 1) % t.seats.length;
    
      return { publicState: pub(t, t.seats[0].id) };
    }    
      ,
  
    /** ベットアクション（fold/check/call/bet/raise） */
// src/engine/TwoSevenGame.ts の action() 全置換
action(tableId: string, playerId: string, action: LowballAction) {
    const t = must(tableId);
    const s = t.seats[t.current];
    if (s.id !== playerId) throw new Error("not your turn");
    if (!s.inHand) throw new Error("folded");
  
    t.round.history.push({ seatId: s.id, a: action });
    const betSize = t.round.allowed.bet;
    const need = (id: string) => t.round.currentBet - (t.round.committed[id] ?? 0);
      
    if (action === "fold") {
      s.inHand = false;
  
    } else if (action === "check") {
      if (need(s.id) > 0) throw new Error("cannot check facing bet");
  
    } else if (action === "call") {
      const n = need(s.id);
      if (n <= 0) throw new Error("nothing to call");
      t.round.committed[s.id] += n;
      t.round.pot += n;
  
    } else if (action === "bet") {
      // ★ オープンベットは cap 対象外
      if (t.round.currentBet > 0) throw new Error("bet not allowed after bet; use raise");
      t.round.currentBet = betSize;
      t.round.committed[s.id] += betSize;
      t.round.pot += betSize;
      // ★ raises は増やさない（ベットはカウント対象外）
  
    } else if (action === "raise") {
      if (t.round.currentBet === 0) throw new Error("nothing to raise");
      // ★ cap は「レイズ回数」にのみ適用
      if (t.round.raises >= t.config.cap) throw new Error("bet/raise cap reached");
      t.round.currentBet += betSize;
      const add = need(s.id);
      if (add <= 0) throw new Error("nothing to add");
      t.round.committed[s.id] += add;
      t.round.pot += add;
      t.round.raises++; // ★ ここだけ増やす
  
    } else {
      throw new Error("unknown action");
    }
  
    t.round.history.push({ seatId: s.id, a: action });

    // ★ everyoneMatched 判定
    const alive = t.seats.filter(se => se.inHand);
    const everyoneMatched = alive.every(se =>
      (t.round.currentBet - (t.round.committed[se.id] ?? 0)) <= 0
    );

    if (everyoneMatched) {
      // 次フェーズはドロー。今の next 手番からスタート
      advanceTurn(t);            // ← 先に“次の人”へ
      t.mode = "draw";
      t.drawStart = t.current;   // ★この位置から一巡したらドロー完了
      return { publicState: pub(t, playerId) };
    } else {
      advanceTurn(t);            // まだベット継続
      t.mode = "bet";
      return { publicState: pub(t, playerId) };
    }

    advanceTurn(t);
    return { publicState: pub(t, playerId) };
  }  
    ,
  
    /** ドロー（捨てるカード配列。0枚なら[]） */
    draw(tableId: string, playerId: string, discard: Card[]) {
      const t = must(tableId);
      if (t.mode !== "draw") throw new Error("not draw phase");  // ★追加

      const s = t.seats[t.current];
      if (s.id !== playerId) throw new Error("not your turn");
      if (!s.inHand) throw new Error("folded");
      if (s.drawsRemaining <= 0) throw new Error("no draws remaining");
      if (discard.length > 3) throw new Error("max 3 discards");
 
      t.mode = "draw"; // ★ ドロー中
      const hand = (s.hand as Card[]).slice();
      // 捨て札検証
      for (const d of discard) {
        const idx = hand.indexOf(d);
        if (idx < 0) throw new Error("card not in hand");
        hand.splice(idx, 1);
      }
      // 実際に捨てる
      for (const d of discard) {
        const idx = (s.hand as Card[]).indexOf(d);
        const [gone] = (s.hand as Card[]).splice(idx, 1);
        t.discards.push(gone);
      }
      // 引き直し
      const add = drawFromDeck(t, discard.length);
      (s.hand as Card[]).push(...add);
      s.drawsRemaining--;
  
      advanceTurn(t);
  
      // ★ ドローが一巡したか？（開始地点に戻ったら完了）
      if (t.drawStart !== undefined && t.current === t.drawStart) {
        const next = nextStreetAfterDraw(t.round.street);
        if (next) {
          initBetRound(t, next);
          t.mode = "bet";
          t.drawStart = undefined;        // クリア

          // ★ 次のベットは“最初に生きている席”から（p1 始動の簡易版）
          let idx = 0;
          while (!t.seats[idx].inHand) idx = (idx + 1) % t.seats.length;
          t.current = idx;                // ここでは p1 が最初に来る設計
        }
      }
  
      return { publicState: pub(t, playerId) };
    },
  
    /** ショーダウン（単純比較。タイは等分等の分配は未実装の雛形） */
    showdown(tableId: string) {
      const t = must(tableId);
      const alive = t.seats.filter(s => s.inHand);
      if (alive.length === 0) return { winners: [], pot: t.round.pot, best: undefined };
    
      const ranked = [...alive].sort((a, b) => cmp27(a.hand!, b.hand!));
      const best = ranked[0];
      const winners = ranked.filter(s => cmp27(s.hand!, best.hand!) === 0);
    
      // ★ 均等配分（端数は先着順で1点ずつ）
      const pot = t.round.pot;
      const share = Math.floor(pot / winners.length);
      let rem = pot - share * winners.length;
      for (const w of winners) {
        w.stack += share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
      }
    
      // ★ 次ハンド準備（ボタン回す・状態初期化）
      t.buttonIndex = (t.buttonIndex + 1) % t.seats.length;
      t.round.pot = 0;
      t.round.currentBet = 0;
      t.round.raises = 0;
      t.mode = "bet";
      t.drawStart = undefined;
    
      return { winners: winners.map(w => w.id), pot, best: best.hand, stacks: Object.fromEntries(t.seats.map(s => [s.id, s.stack])) };
    }    
    ,
  
    /** 内部用：テーブルの生データ参照（AutoRunnerが使用） */
    _peek(tableId: string) {
      return must(tableId);
    },
  
    /** p1視点の公開状態を取得（API応答用） */
    getPublicState(tableId: string, heroId: string) {
      const t = must(tableId);
      return pub(t, heroId);
    },
  };
  
  