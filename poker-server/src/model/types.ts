// === 共通カード型（"As","Td","7c" など）=========================
export type Card =
  `${"A"|"K"|"Q"|"J"|"T"|`${9|8|7|6|5|4|3|2}`}${"h"|"d"|"c"|"s"}`;

// === 旧NLHE向け（残してもOK。使わないなら削除可）=================
export type Action = "fold" | "check" | "call" | "raise";

export interface Seat {
  id: string;           // "p1" など
  stack: number;        // 残りスタック
  hand?: [Card, Card];  // NLHE用（2枚）
  inHand: boolean;      // プレイ中
}

export interface BettingRound {
  street: "pre" | "flop" | "turn" | "river";
  pot: number;
  allowedSizes: (number | "allin")[];
  history: { seatId: string; a: Action; size?: number | "allin" }[];
  currentBet: number;
  committed: Record<string, number>;
}

export interface TableState {
  id: string;
  seats: Seat[];
  deck: Card[];
  board: Card[];
  current: number;
  round: BettingRound;
}

export interface PublicState {
  tableId: string;
  heroSeatId: string;
  heroHand?: [Card, Card];
  board: Card[];
  stacks: Record<string, number>;
  pot: number;
  toCall: number;
  allowedSizes: (number | "allin")[];
  street: "pre" | "flop" | "turn" | "river";
  actionHistory: { seatId: string; a: Action; size?: number | "allin" }[];
}

// === 2–7 Triple Draw 用 ==========================================

// ベットアクション（リミットゲーム）
export type LowballAction = "fold" | "check" | "call" | "bet" | "raise";

// ベットの4ラウンド（プレ → 3回のドロー後それぞれの後にベット）
export type DrawStreet = "pre" | "post1" | "post2" | "post3";

// リミット設定
export interface LimitConfig {
  smallBet: number;   // 例: 1
  bigBet: number;     // 例: 2
  cap: number;        // 1ラウンドの bet/raise 最大回数（例: 4）
}

// 2–7 の座席（5枚手札と残りドロー回数）
export interface DrawSeat {
  id: string;
  stack: number;
  hand?: [Card, Card, Card, Card, Card]; // 5枚
  inHand: boolean;
  drawsRemaining: number;                // 初期3
}

// 2–7 のベットラウンド状態
export interface DrawRound {
  street: DrawStreet;
  pot: number;
  allowed: { kind: "limit"; bet: number }; // small/big ベット額
  history: { seatId: string; a: LowballAction }[];
  currentBet: number;                      // 現在要求されている合計額
  committed: Record<string, number>;       // 各席の当該ラウンド投入額
  raises: number;                          // bet/raise 回数（cap管理用）
}

// テーブル全体
export interface DrawTableState {
  id: string;
  seats: DrawSeat[];
  deck: Card[];
  discards: Card[];       // 共有の捨て札山
  current: number;        // 現在の手番 index
  round: DrawRound;
  config: LimitConfig;

  // ★ 追加：現在のフェーズ（ベット or ドロー）
  mode: "bet" | "draw";
  drawStart?: number;            // ★追加：このドローの開始位置

    // ★ 追加
  buttonIndex: number;
  blinds: BlindsConfig;

}

// クライアントに返す公開情報（p1視点）
export interface DrawPublicState {
  tableId: string;
  heroSeatId: string;
  heroHand?: [Card, Card, Card, Card, Card];  // 自分だけ見える
  pot: number;
  toCall: number;
  street: DrawStreet;
  actionHistory: { seatId: string; a: LowballAction }[];
}

export interface BlindsConfig {
  smallBlind: number; // 例: 1
  bigBlind: number;   // 例: 2
}


