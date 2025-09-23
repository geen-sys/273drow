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
  function initBetRound(t: DrawTableState, street: "pre"|"post1"|"post2"|"post3") {
    t.round = {
      street,
      pot: t.round?.pot ?? 0,
      currentBet: 0,
      raises: 0,
      committed: {},
      cap: t.config.cap,
      // ★ 追加：このベットラウンドが「どこから始まったか」を記録
      firstToAct: t.current,
      didAct: false,
      allowed: t.round?.allowed ?? undefined, // 一旦置き、直後に updateAllowed で上書き
    } as any;
  
    t.mode = "bet";
    updateAllowed(t); // ★ これが肝
  }
  

  function betSizeFor(t: DrawTableState): number {
    return (t.round.street === "pre" || t.round.street === "post1")
      ? t.config.smallBet
      : t.config.bigBet;
  }
  
  // ★ round.allowed を都度再計算
  function updateAllowed(t: DrawTableState) {
    // allowed は「このラウンドの単位額」を持つ“定数”でOK
    // ※ call/raise の可否は各席の toCall や cap で別途判断する前提
    const size = betSizeFor(t);
  
    t.round.allowed = {
      bet: size,                                  // ← 先頭プレイヤーでも常にベット可能
      raise: (t.round.raises < t.config.cap) ? size : 0,
      call: t.round.currentBet,                   // 便宜上ラウンドのベースを置く（席ごとの toCall は別途）
      check: 1,                                   // toCall=0 の席だけが押せるのはフロント/呼び出し側で判定
    } as any; // 既存型がなければ any で当面回し、後で RoundAllowed の型を足してください
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
  
  function everyoneMatchedNow(t: DrawTableState) {
    const alive = t.seats.filter(s => s.inHand);
    return alive.every(s => (t.round.committed[s.id] ?? 0) === t.round.currentBet);
  }
  
  // ★ ラウンド閉じるか判定（action() の末尾で呼ぶ）
  function maybeCloseBetRound(t: DrawTableState) {
    // 残り1人なら即ショウダウン
    const alive = t.seats.filter(s => s.inHand);
    if (alive.length === 1) {
      t.mode = "showdown";
      return;
    }
  
    // まだ誰も何もしていない場合は「揃っていても閉じない」
    if (!t.round.didAct) return;
  
    const wrapped = (t.current === t.round.firstToAct); // 一周して先頭に戻ってきたか
    const matched = everyoneMatchedNow(t);
  
    if (matched && wrapped) {
      if (t.round.street === "post3") {
        t.mode = "showdown";
      } else {
        // 次はドローへ
        t.mode = "draw";
        t.drawStart = t.current;
        // 各ドローに1回ずつの引き直し権
        for (const s of t.seats) if (s.inHand) s.drawsRemaining = 1;
      }
    }
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
    
      // デッキ/手札配り
      t.deck = shuffle(freshDeck());
      t.discards = [];
      for (const s of t.seats) {
        s.inHand = true;
        s.drawsRemaining = 3;
        (s as any).hand = drawFromDeck(t, 5) as [Card,Card,Card,Card,Card];
      }
    
      // ボタン基準で SB / BB を決定
      const sbIdx = (t.buttonIndex + 1) % t.seats.length;
      const bbIdx = (t.buttonIndex + 2) % t.seats.length;
      const sb = t.seats[sbIdx], bb = t.seats[bbIdx];
    
      // ★ まずラウンドを初期化（空）
      initBetRound(t, "pre");
    
      // ★ ブラインドを committed / pot / currentBet に反映
      const add = (id: string, amt: number) => {
        t.round.committed[id] = (t.round.committed[id] ?? 0) + amt;
      };
      add(sb.id, t.blinds.smallBlind);
      add(bb.id, t.blinds.bigBlind);
      t.round.pot += t.blinds.smallBlind + t.blinds.bigBlind;
      t.round.currentBet = t.blinds.bigBlind;
    
      // ★ 最初に行動するのは BB の左（= UTG）
      t.current = (bbIdx + 1) % t.seats.length;
      t.round.firstToAct = t.current;   // ← 一周判定用
    
      // allowed 更新（スモール/ビッグの単位を street で切替しているならそのロジックで）
      updateAllowed(t);  // なければ省略可。あれば bet/raise 単位を設定。
    
      t.mode = "bet";
      return { publicState: pub(t, t.seats[0].id) }; // heroId はあなたの実装に合わせて
    }        
      ,
  
    /** ベットアクション（fold/check/call/bet/raise） */
// src/engine/TwoSevenGame.ts の action() 全置換
action(tableId: string, playerId: string, action: "check" | "call" | "bet" | "raise" | "fold") {
  const t = must(tableId);

  if (t.mode !== "bet") {
    throw new Error("not bet phase");
  }

  const seat = t.seats[t.current];
  if (!seat) throw new Error("seat not found");
  if (seat.id !== playerId) throw new Error("not your turn");
  if (!seat.inHand) throw new Error("folded");

  // --- ベットサイズ（リミット） ---
  const betSize = (t.round.street === "pre" || t.round.street === "post1")
    ? t.config.smallBet
    : t.config.bigBet;

  const committed = t.round.committed;
  if (committed[seat.id] == null) committed[seat.id] = 0;

  const toCall = Math.max(0, t.round.currentBet - committed[seat.id]);

  // ユーティリティ：チップ移動（今回はスタック差分を厳密に運用していない想定。必要ならstackも減らす）
  const pay = (who: string, amount: number) => {
    committed[who] = (committed[who] ?? 0) + amount;
    t.round.pot += amount;
  };

  // --- アクション適用 ---
  switch (action) {
    case "fold": {
      seat.inHand = false;

      // 残り1人なら即ショウダウン状態へ
      const alive = t.seats.filter(s => s.inHand);
      if (alive.length === 1) {
        t.mode = "showdown";
        return { publicState: pub(t, playerId) };
      }

      // 次の手番へ
      advanceTurn(t);
      return { publicState: pub(t, playerId) };
    }

    case "check": {
      if (toCall > 0) throw new Error("cannot check when toCall > 0");

      // そのまま手番回す
      advanceTurn(t);
      break;
    }

    case "call": {
      if (toCall === 0) throw new Error("nothing to call");
      pay(seat.id, toCall);
      // 手番回す
      advanceTurn(t);
      break;
    }

    case "bet": {
      // まだ誰もベットしていない時だけ許可
      if (t.round.currentBet !== 0) throw new Error("cannot bet, bet already set (raise instead)");
      // キャップ確認（ベットはレイズとして1回カウント）
      if ((t.round.raises ?? 0) >= (t.config.cap ?? 4)) throw new Error("bet/raise cap reached");

      // 自分がベット額を支払って currentBet を更新
      t.round.currentBet = betSize;
      const need = t.round.currentBet - committed[seat.id];
      pay(seat.id, need);

      t.round.raises = (t.round.raises ?? 0) + 1;

      advanceTurn(t);
      break;
    }

    case "raise": {
      if (t.round.currentBet === 0) throw new Error("nothing to raise"); // まずはbetから
      if ((t.round.raises ?? 0) >= (t.config.cap ?? 4)) throw new Error("bet/raise cap reached");

      // レイズ＝ currentBet に betSize を上乗せ
      t.round.currentBet += betSize;

      // 自分のコミットを新しい currentBet まで引き上げ
      const need = t.round.currentBet - committed[seat.id];
      if (need <= 0) throw new Error("already matched"); // 理論上起きにくいが保険
      pay(seat.id, need);

      t.round.raises = (t.round.raises ?? 0) + 1;

      advanceTurn(t);
      break;
    }
  }

  // --- ラウンド締め判定 ---
  const alive = t.seats.filter(s => s.inHand);
  const onlyOneLeft = alive.length === 1;
  if (onlyOneLeft) {
    // 誰かがフォールドして残り1人なら即ショウダウン
    t.mode = "showdown";
    return { publicState: pub(t, playerId) };
  }

  const everyoneMatched = alive.every(s => {
    const c = committed[s.id] ?? 0;
    return c === t.round.currentBet;
  });

  if (everyoneMatched) {
    // ベット・レイズの応酬が終わって全員が currentBet に到達

    if (t.round.street === "post3") {
      // ★ 最終ベットラウンドが締まった → ショウダウンへ
      t.mode = "showdown";
      return { publicState: pub(t, playerId) };
    }

    // ★ まだ最終ではない → 次はドローフェーズへ
    t.mode = "draw";
    t.drawStart = t.current;

    // 各ドローごとに1回のみ引けるようリセット
    for (const s of t.seats) {
      if (s.inHand) s.drawsRemaining = 1;
    }
    return { publicState: pub(t, playerId) };
  }

  // …各アクション適用後
  t.round.didAct = true;  // ★ 最低1人は何かした

  // ラウンド締め判定（4で詳細）
  maybeCloseBetRound(t);

  // 最後に allowed を更新（サイズやcapが変わることは少ないが常に整合を保つ）
  updateAllowed(t);

  // まだ締まっていない → そのままベット継続
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
  
      // ★ このドローラウンドでの権利を使い切った扱い（スタンドパットでも 0）
      s.drawsRemaining = 0;
      
      advanceTurn(t);
  
      // draw() の最後、advanceTurn(t) の後
      if (t.drawStart !== undefined && t.current === t.drawStart) {
        const next = t.round.street === "pre" ? "post1"
                   : t.round.street === "post1" ? "post2"
                   : "post3";
        initBetRound(t, next);
        t.mode = "bet";
        t.drawStart = undefined;
      
        // ★ ここでも allowed を確実に更新（initBetRound 内でも呼んでるので冗長だが安全）
        updateAllowed(t);
      
        return { publicState: pub(t, playerId) };
      }

  
      return { publicState: pub(t, playerId) };
    },
  
    // これを TwoSevenGame の中に追加
    getDebug(tableId: string) {
      const t = must(tableId);

      // round が未初期化でも安全に読む
      const r = t.round ?? {
        street: "pre" as const,
        pot: 0,
        currentBet: 0,
        raises: 0,
        cap: t.config?.cap ?? 4,
        committed: {} as Record<string, number>,
      };

      const currentSeat = t.seats?.[t.current]?.id ?? "p1";

      return {
        street: r.street,
        pot: r.pot ?? 0,
        currentBet: r.currentBet ?? 0,
        raises: r.raises ?? 0,
        cap: t.config?.cap ?? 4,
        committed: r.committed ?? {},
        currentSeat,
        mode: t.mode as "bet" | "draw"  | "showdown" | undefined,
        drawStart: t.drawStart,
      };
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
  

