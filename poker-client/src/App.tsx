import React, { useEffect, useMemo, useState } from "react";

// ===== Deuce-to-Seven Triple Draw — Minimal Client (App.tsx) =====
// サーバAPI: /d27/table/new, /d27/hand/deal, /d27/auto/run, /d27/hand/action, /d27/hand/draw, /d27/showdown, /d27/hand/new, /d27/debug/round

// ▼ サーバの場所（Viteの開発プロキシを使うなら "" にして相対パスで叩く）
//   vite.config.ts 例:
//   server: { proxy: { "/d27": { target: "http://localhost:8787", changeOrigin: true } } }
const API_BASE = "http://localhost:8787"; // or "" (proxy)

type Card =
  | "Ah" | "Ad" | "Ac" | "As" | "Kh" | "Kd" | "Kc" | "Ks" | "Qh" | "Qd" | "Qc" | "Qs"
  | "Jh" | "Jd" | "Jc" | "Js" | "Th" | "Td" | "Tc" | "Ts" | "9h" | "9d" | "9c" | "9s"
  | "8h" | "8d" | "8c" | "8s" | "7h" | "7d" | "7c" | "7s" | "6h" | "6d" | "6c" | "6s"
  | "5h" | "5d" | "5c" | "5s" | "4h" | "4d" | "4c" | "4s" | "3h" | "3d" | "3c" | "3s"
  | "2h" | "2d" | "2c" | "2s";

type PublicState = {
  tableId: string;
  heroSeatId: string;       // "p1"
  heroHand: Card[];         // 5枚
  pot: number;
  toCall: number;           // この額をコールすれば良い
  street: "pre" | "post1" | "post2" | "post3";
  actionHistory: { seatId: string; a: string; size?: number }[];
};

type DebugRound = {
  street: "pre" | "post1" | "post2" | "post3";
  pot: number;
  currentBet: number;
  raises: number;
  cap: number;
  committed: Record<string, number>;
  currentSeat: string;            // 今の手番 (例: "p1")
  mode?: "bet" | "draw" | "showdown";          // サーバが返すなら使用
  drawStart?: number;
};

// === 追加：カード描画ヘルパ ===
type Suit = "s" | "h" | "d" | "c";

type ShowdownResult = {
  winners: string[];
  pot: number;
  best?: string[] | string;
  stacks?: Record<string, number>;
};

const suitGlyph: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };


export default function App() {
  // ---------- 状態 ----------
  const [tableId, setTableId]     = useState<string>("");
  const [state, setState]         = useState<PublicState | null>(null);
  const [debug, setDebug]         = useState<DebugRound | null>(null);
  const [discards, setDiscards]   = useState<Card[]>([]);
  const [loading, setLoading]     = useState(false);
  const [err, setErr]             = useState<string>("");
  // ★ Hook はコンポーネントの“直下”に置く（外に出さない）
  const [selected, setSelected] = useState<string[]>([]);
  const [hand, setHand] = useState<Card[]>(["Ah", "Kd", "7c", "3d", "9s"]); // 仮の手札（サーバ取得後は置き換え）

  const [result, setResult] = useState<ShowdownResult | null>(null);
  const toggleSelect = (card: string) => {
    setSelected(prev =>
      prev.includes(card) ? prev.filter(c => c !== card) : [...prev, card]
    );
  };

  // ---------- 便利参照 ----------
  const heroHand = state?.heroHand ?? [];

  // ---------- 共通POST（ボディなしはヘッダーを付けない：空JSONエラー回避） ----------
  async function callApi<T = any>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`http://localhost:8787${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : JSON.stringify({}), // ★ 空でも {} を送る
    });
    const text = await res.text(); // ★ 先に text を取る（エラー時も安全）
    if (!res.ok) {
      // サーバが {message} を返す想定
      let msg = text;
      try { const j = JSON.parse(text); if (j?.message) msg = j.message; } catch {}
      throw new Error(`${res.status} ${res.statusText} - ${msg}`);
    }
    try { return JSON.parse(text); } catch { return text as any; }
  }
  

async function onNewTable() {
  try {
    const { tableId } = await callApi<{ tableId: string }>("/d27/table/new", {});
    setTableId(tableId);
    setState(null);
    setDebug(null);
  } catch (e) {
    console.error(e);
    alert("New Table failed");
  }
}

async function onDeal() {
  if (!tableId) return alert("No table. New Table first.");
  try {
    const ps = await callApi<PublicState>("/d27/hand/deal", { tableId }); // ★ tableId を必ず送る
    setState(ps);
    const dbg = await callApi<DebugRound>("/d27/debug/round", { tableId });
    setDebug(dbg);
  } catch (e) {
    console.error(e);
    alert("Deal failed");
  }
}

async function onAutoRun() {
  if (!tableId) return alert("No table. New Table first.");
  try {
    await callApi("/d27/auto/run", { tableId }); // ★ tableId を必ず送る
    const ps = await callApi<PublicState>("/d27/state", { tableId, heroId: "p1" }).catch(() => null);
    if (ps) setState(ps);
    const dbg = await callApi<DebugRound>("/d27/debug/round", { tableId });
    setDebug(dbg);
  } catch (e) {
    console.error(e);
    alert("Auto Run failed");
  }
}


  async function onNewHand() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/hand/new", { tableId });
    setState(st);
    setDiscards([]);
    setResult(null);       // ★ 前回の結果を消す
    await refreshDebug();
  }

  async function act(kind: "bet" | "check" | "call" | "raise" | "fold") {
    if (!state) return;
    try {
      // 行動 → PublicState が返る前提
      const ps = await callApi<PublicState>("/d27/hand/action", {
        tableId: state.tableId,
        playerId: state.heroSeatId, // "p1"
        action: kind,
      });
      setState(ps);                 // ★ ここで即反映
  
      // デバッグ情報も取り直す
      await refreshDebug();
  
      // （任意）相手番を一気に進めたい場合
      await callApi("/d27/auto/run", { tableId: state.tableId });
      await refreshDebug();
    } catch (e) {
      console.error(e);
      alert("action failed");
    }
  }
  
  

  async function onDraw() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/hand/draw", {
      tableId,
      playerId: "p1",
      discard: discards,
    });
    setSelected([]);//捨てた後は選択をリセット
    setState(st);
    setDiscards([]);
    await refreshDebug();
  }

  async function onShowdown() {
    if (!tableId) return;
    const r = await callApi<ShowdownResult>("/d27/showdown", { tableId });
    setResult(r);          // ← ここで結果を保存
    await refreshDebug();
  }

  async function refreshDebug() {
    if (!tableId) return;
    try {
      const dbg = await callApi<DebugRound>("/d27/debug/round", { tableId });
      setDebug(dbg);
    } catch {
      // サーバが未実装でも無視
    }
  }

  
  // ---------- 選択/表示ヘルパ ----------
  function toggleDiscard(card: Card) {
    setDiscards(prev => {
      const i = prev.indexOf(card);
      if (i >= 0) {
        const cp = prev.slice();
        cp.splice(i, 1);
        return cp;
      }
      if (prev.length >= 3) return prev;
      return [...prev, card];
    });
  }

  // ---------- 「今できること」フラグ ----------
  const isDrawPhase = debug?.mode === "draw";
  const isBetPhase  = debug?.mode === "bet";
  const isYourTurn  = debug?.currentSeat === "p1";
  const isShowdown = debug?.mode === "showdown";

  const canCheck   = !!state && isBetPhase && isYourTurn && (state.toCall ?? 0) === 0;
  const canCall    = !!state && isBetPhase && isYourTurn && (state.toCall ?? 0) > 0;
  const canBet     = !!state && isBetPhase && isYourTurn && (state.toCall ?? 0) === 0;
  const canRaise   = !!state && isBetPhase && isYourTurn && (state.toCall ?? 0) > 0 && (debug?.raises ?? 0) < (debug?.cap ?? 0);
  const canFold    = !!state && isBetPhase && isYourTurn;
  const canDrawNow = !!state && isDrawPhase && isYourTurn && discards.length <= 3;

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 flex flex-col items-center p-6 gap-6">
      <div className="w-full max-w-4xl">
      <h1 className="game-title">
          2–7 Triple Draw
          <span className="game-sub"> prototype </span>
        </h1>
        <p className="text-sm text-neutral-400">API: <span className="font-mono">{API_BASE || "(proxy)"}</span></p>
      </div>

      {/* Controls */}
      <div className="w-full max-w-4xl grid grid-cols-2 md:grid-cols-3 gap-2">
        <button className="btn" onClick={onNewTable} disabled={loading}>New Table</button>
        <button className="btn" onClick={onDeal} disabled={!tableId || loading}>Deal</button>
        <button className="btn" onClick={onAutoRun} disabled={!tableId || loading || isYourTurn || isShowdown}>Auto Run (to p1)</button>

        <button className="btn" onClick={() => act("check")} disabled={!canCheck || loading || isShowdown} title={!canCheck ? "自分の番のベットフェーズで、toCall=0の時だけ" : ""}>Check</button>
        <button className="btn" onClick={() => act("call")} disabled={!canCall || loading || isShowdown} title={!canCall ? "自分の番のベットフェーズで、コール額がある時だけ" : ""}>Call {state?.toCall ? `(${state?.toCall})` : ""}</button>
        <button className="btn" onClick={() => act("bet")} disabled={!canBet || loading || isShowdown} title={!canBet ? "自分の番のベットフェーズで、未ベット時のみ" : ""}>Bet</button>
        <button className="btn" onClick={() => act("raise")} disabled={!canRaise || loading || isShowdown} title={!canRaise ? "自分の番のベットフェーズで、ベットがありcap未到達の時" : ""}>Raise</button>
        <button className="btn !bg-red-600 hover:!bg-red-700" onClick={() => act("fold")} disabled={!canFold || loading || isShowdown} title="ベットフェーズ中のみ">Fold</button>

        <button
          type="button"
          className="btn"
          onClick={onDraw}
          disabled={!canDrawNow || loading}
          title={isDrawPhase ? (isYourTurn ? "選んだ枚数だけ引き直します" : "自分の番を待っています") : "ドローフェーズでのみ使用できます"}
        >
          Draw ({discards.length})
        </button>

        <button className="btn" onClick={onShowdown} disabled={!tableId || loading}>Showdown</button>
        <button className="btn" onClick={onNewHand} disabled={!tableId || loading}>New Hand</button>
        <button className="btn" onClick={refreshDebug} disabled={!tableId || loading}>Refresh Debug</button>
      </div>

      {err && (
        <div className="w-full max-w-4xl bg-red-950/50 border border-red-700 text-red-200 rounded-xl p-3">
          <div className="font-semibold">Error</div>
          <div className="text-sm whitespace-pre-wrap">{err}</div>
        </div>
      )}

      {/* Table + Hand */}
      <div className="w-full max-w-4xl grid gap-4">
        <div className="bg-neutral-900/60 rounded-2xl p-4 border border-neutral-800">
          <div className="flex justify-between items-center">
            <div className="text-lg font-medium">Table: <span className="font-mono">{tableId || "—"}</span></div>
            <div className="text-sm text-neutral-400">Street: <span className="font-mono">{state?.street ?? "—"}</span></div>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <div>Pot: <span className="font-mono">{state?.pot ?? 0}</span></div>
            <div>To Call: <span className="font-mono">{state?.toCall ?? 0}</span></div>
            <div>Hero: <span className="font-mono">{state?.heroSeatId ?? "p1"}</span></div>
          </div>

          {/* 状況ガイド（ショウダウン優先） */}
          <div className="mt-3 p-3 rounded-xl border border-neutral-800 bg-neutral-900/60">
            <div className="text-sm">
              <span className="mr-2">Phase: <span className="font-mono">{debug?.mode ?? "—"}</span></span>
              <span className="mr-2">Turn: <span className="font-mono">{debug?.currentSeat ?? "—"}</span></span>
              <span className="mr-2">Raises: <span className="font-mono">{debug?.raises ?? 0}/{debug?.cap ?? "?"}</span></span>
              <span className="mr-2">CurrentBet: <span className="font-mono">{debug?.currentBet ?? 0}</span></span>
              <span className="mr-2">Pot: <span className="font-mono">{state?.pot ?? 0}</span></span>
            </div>

            <div className="text-sm mt-2">
              {isShowdown ? (
                // ★ ショウダウン最優先：相手ターンの文言は出さない
                <span className="text-emerald-300">
                  ショウダウンです。「Showdown」ボタンを押して結果を表示してください。
                </span>
              ) : isYourTurn ? (
                isDrawPhase ? (
                  <span className="text-emerald-300">
                    あなたの番：ドローフェーズです。捨て札を最大3枚クリック → 「Draw」を押してください。
                  </span>
                ) : isBetPhase ? (
                  (state?.toCall ?? 0) > 0
                    ? <span className="text-emerald-300">あなたの番：{state?.toCall} をコール、またはレイズ/フォールドができます。</span>
                    : <span className="text-emerald-300">あなたの番：ベットするかチェックを選べます。</span>
                ) : (
                  <span className="text-yellow-300">フェーズ情報が未取得です（Refresh Debug を押してください）。</span>
                )
              ) : (
                // 相手の番の案内（※ショウダウン時はここに来ない）
                <span className="text-neutral-300">
                  相手の番です。<b>Auto Run</b> を押すと p1 の番まで進みます。
                </span>
              )}
            </div>
          </div>


          {/* === Result Panel === */}
          {result && (
            <div className="result-panel">
              <div className="result-title">Showdown Result</div>
              <div className="result-line"><b>Winners:</b> {result.winners.join(", ")}</div>
              <div className="result-line"><b>Pot:</b> {result.pot}</div>
              {result.best && (
                <div className="result-line"><b>Best:</b> {Array.isArray(result.best) ? result.best.join(" ") : result.best}</div>
              )}
              {result.stacks && (
                <div className="result-stacks">
                  {Object.entries(result.stacks).map(([pid, chips]) => (
                    <div key={pid} className="stack-item">
                      <span className="mono">{pid}</span>
                      <span className="mono">{chips}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="result-actions">
                <button className="btn" onClick={() => setResult(null)}>Clear</button>
                <button className="btn" onClick={onNewHand} disabled={!tableId}>New Hand</button>
              </div>
            </div>
          )}

          {/* Hero Hand + Discard toggles */}
          <div className="mt-4">
            <div className="text-sm text-neutral-400 mb-2">Click cards to select up to 3 for discard</div>
            {/* ★ 横並びにする行コンテナ（純CSS） */}
            <div className="card-row">
                {heroHand.map((c) => {
                  const on = discards.includes(c);
                  const { rank, suitChar, isRed } = splitCard(c);
                  return (
                    <div
                      key={c}
                      className={`playing-card ${on ? "selected" : ""} ${isRed ? "red" : "black"}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleDiscard(c)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleDiscard(c)}
                      title={on ? "Selected to discard" : "Click to discard"}
                    >
                      {/* 左上 */}
                      <div className="corner tl">
                        <div className="rank">{rank}</div>
                        <div className="suit">{suitChar}</div>
                      </div>
                      {/* 右下 */}
                      <div className="corner br">
                        <div className="rank">{rank}</div>
                        <div className="suit">{suitChar}</div>
                      </div>
                      {/* 中央の大きいスート（透かし色も赤/黒で変える） */}
                      <div className={`center ${isRed ? "red" : "black"}`}>{suitChar}</div>
                    </div>
                  );
                })}
              </div>
                        </div>
        </div>

        {/* Action history */}
        <div className="bg-neutral-900/60 rounded-2xl p-4 border border-neutral-800">
          <div className="text-lg font-medium mb-2">Action History (this round)</div>
          <div className="flex flex-col gap-1 text-sm max-h-48 overflow-auto">
            {(state?.actionHistory ?? []).length === 0 && (
              <div className="text-neutral-500">— no actions yet —</div>
            )}
            {(state?.actionHistory ?? []).map((h, i) => (
              <div key={i} className="font-mono">
                {h.seatId}: {h.a}{h.size ? `(${h.size})` : ""}
              </div>
            ))}
          </div>
        </div>

        {/* Debug viewer */}
        {debug && (
          <div className="bg-neutral-900/60 rounded-2xl p-4 border border-neutral-800">
            <div className="text-lg font-medium mb-2">Debug</div>
            <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(debug, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Inline styles for buttons (Tailwind-like classes are used; this fallback helps if Tailwind isn't set) */}
      <style>{`
        .btn {
          padding: 0.5rem 0.75rem;
          border-radius: 0.75rem;
          background: #262626;
          border: 1px solid #404040;
        }
        .btn:hover { background: #3f3f3f; }
        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );

  function parseCard(c: string) {
    const r = c[0]; // A,K,Q,J,T,9..2
    const s = c[c.length - 1] as Suit; // s,h,d,c
    const rank = r === "T" ? "10" : r;
    const suitChar = { s: "♠", h: "♥", d: "♦", c: "♣" }[s];
    const isRed = s === "h" || s === "d";
    const suitColor = isRed ? "text-red-600" : "text-gray-800";
    return { rank, suit: s, suitChar, isRed, suitColor };
  }
  
  function PlayingCard({
    card,
    selected,
    onClick,
    title,
  }: {
    card: string;
    selected?: boolean;
    onClick?: () => void;
    title?: string;
  }) {
    const { rank, suitChar, isRed, suitColor } = parseCard(card);
  
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick?.()}
        title={title}
        className={[
          // サイズ & 形
          "relative w-24 h-36 rounded-2xl border shadow-lg select-none",
          // ベース（紙っぽい）
          "bg-white/95 border-gray-300",
          "bg-gradient-to-br from-white to-neutral-100",
          // クリック感
          "cursor-pointer transition transform hover:-translate-y-0.5 active:translate-y-0",
          // 選択時のハイライト
          selected ? "ring-4 ring-blue-500" : "ring-1 ring-neutral-300",
        ].join(" ")}
        style={{ fontFeatureSettings: '"tnum" 1' }}
      >
        {/* 左上のランク/スート */}
        <div className={`absolute top-2 left-2 text-left leading-none ${suitColor}`}>
          <div className="font-black text-xl">{rank}</div>
          <div className="text-lg -mt-0.5">{suitChar}</div>
        </div>
  
        {/* 右下のランク/スート（180度回転） */}
        <div className={`absolute bottom-2 right-2 text-right leading-none rotate-180 ${suitColor}`}>
          <div className="font-black text-xl">{rank}</div>
          <div className="text-lg -mt-0.5">{suitChar}</div>
        </div>
  
        {/* 中央の大きめスート透かし */}
        <div
          className={[
            "absolute inset-0 flex items-center justify-center pointer-events-none",
            isRed ? "text-red-200" : "text-gray-300",
          ].join(" ")}
        >
          <div className="text-5xl opacity-70">{suitChar}</div>
        </div>
      </div>
    );
  }
  function splitCard(c: string) {
    const r = c[0] === "T" ? "10" : c[0];         // T -> 10
    const s = c[c.length - 1];                    // s|h|d|c
    const isRed = s === "h" || s === "d";
    return { rank: r, suit: s, suitChar: suitGlyph[s], isRed };
  }
}
