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

  const toggleSelect = (card: string) => {
    setSelected(prev =>
      prev.includes(card) ? prev.filter(c => c !== card) : [...prev, card]
    );
  };

  // ---------- 便利参照 ----------
  const heroHand = state?.heroHand ?? [];

  // ---------- 共通POST（ボディなしはヘッダーを付けない：空JSONエラー回避） ----------
  async function callApi<T>(path: string, body?: any): Promise<T> {
    setLoading(true);
    setErr("");
    try {
      const init: RequestInit = { method: "POST" };
      if (body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const res = await fetch(`${API_BASE}${path}`, init);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || "HTTP error");
      return json as T;
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }

  // ---------- API呼び出し ----------
  async function onNewTable() {
    const r = await callApi<{ tableId: string }>("/d27/table/new", {}); // {} を送るのが楽
    setTableId(r.tableId);
    setState(null);
    setDiscards([]);
    setDebug(null);
  }

  async function onDeal() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/hand/deal", { tableId });
    setState(st);
    setDiscards([]);
    await refreshDebug();
  }

  async function onNewHand() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/hand/new", { tableId });
    setState(st);
    setDiscards([]);
    await refreshDebug();
  }

  async function onAutoRun() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/auto/run", { tableId });
    setState(st);
    await refreshDebug();
  }

  async function act(a: "check" | "call" | "bet" | "raise" | "fold") {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/hand/action", {
      tableId,
      playerId: "p1",
      action: a,
    });
    setState(st);
    setDiscards([]);
    await refreshDebug();
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
    const r = await callApi<any>("/d27/showdown", { tableId });
    alert(`Winners: ${r.winners?.join(", ")}\nPot: ${r.pot}\nBest: ${Array.isArray(r.best) ? r.best.join(" ") : r.best}\n${r.stacks ? "Stacks: " + JSON.stringify(r.stacks) : ""}`);
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
        <h1 className="text-2xl font-semibold tracking-tight">Deuce-to-Seven Triple Draw — Minimal Client</h1>
        <p className="text-sm text-neutral-400">API: <span className="font-mono">{API_BASE || "(proxy)"}</span></p>
      </div>

      {/* Controls */}
      <div className="w-full max-w-4xl grid grid-cols-2 md:grid-cols-3 gap-2">
        <button className="btn" onClick={onNewTable} disabled={loading}>New Table</button>
        <button className="btn" onClick={onDeal} disabled={!tableId || loading}>Deal</button>
        <button className="btn" onClick={onAutoRun} disabled={!tableId || loading || isYourTurn}>Auto Run (to p1)</button>

        <button className="btn" onClick={() => act("check")} disabled={!canCheck || loading} title={!canCheck ? "自分の番のベットフェーズで、toCall=0の時だけ" : ""}>Check</button>
        <button className="btn" onClick={() => act("call")} disabled={!canCall || loading} title={!canCall ? "自分の番のベットフェーズで、コール額がある時だけ" : ""}>Call {state?.toCall ? `(${state?.toCall})` : ""}</button>
        <button className="btn" onClick={() => act("bet")} disabled={!canBet || loading} title={!canBet ? "自分の番のベットフェーズで、未ベット時のみ" : ""}>Bet</button>
        <button className="btn" onClick={() => act("raise")} disabled={!canRaise || loading} title={!canRaise ? "自分の番のベットフェーズで、ベットがありcap未到達の時" : ""}>Raise</button>
        <button className="btn !bg-red-600 hover:!bg-red-700" onClick={() => act("fold")} disabled={!canFold || loading} title="ベットフェーズ中のみ">Fold</button>

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

          {/* 状況ガイド */}
          <div className="mt-3 p-3 rounded-xl border border-neutral-800 bg-neutral-900/60">
            <div className="text-sm">
              <span className="mr-2">Phase: <span className="font-mono">{debug?.mode ?? "—"}</span></span>
              <span className="mr-2">Turn: <span className="font-mono">{debug?.currentSeat ?? "—"}</span></span>
              <span className="mr-2">Raises: <span className="font-mono">{debug?.raises ?? 0}/{debug?.cap ?? "?"}</span></span>
              <span className="mr-2">CurrentBet: <span className="font-mono">{debug?.currentBet ?? 0}</span></span>
              <span className="mr-2">Pot: <span className="font-mono">{state?.pot ?? 0}</span></span>
            </div>
            <div className="text-sm mt-2">
              {isYourTurn ? (
                isDrawPhase ? (
                  <span className="text-emerald-300">あなたの番：ドローフェーズです。捨て札を最大3枚クリック → 「Draw」を押してください。</span>
                ) : isBetPhase ? (
                  (state?.toCall ?? 0) > 0
                    ? <span className="text-emerald-300">あなたの番：{state?.toCall} をコール、またはレイズ/フォールドができます。</span>
                    : <span className="text-emerald-300">あなたの番：ベットするかチェックを選べます。</span>
                ) : (
                  <span className="text-yellow-300">フェーズ情報が未取得です（Refresh Debug を押してください）。</span>
                )
              ) : (
                <span className="text-neutral-300">相手の番です。<b>Auto Run</b> を押すと p1 の番まで進みます。</span>
              )}
              {isShowdown && (
                <span className="text-emerald-300">
                  ショウダウンです。「Showdown」ボタンを押して結果を表示してください。
                </span>
              )}
            </div>
          </div>

          {/* Hero Hand + Discard toggles */}
          <div className="mt-4">
            <div className="text-sm text-neutral-400 mb-2">Click cards to select up to 3 for discard</div>
            <div className="flex flex-wrap gap-2">
              {heroHand.map((c) => {
                const on = discards.includes(c);
                return (
                  <button
                    type="button"
                    key={c}
                    onClick={() => toggleDiscard(c)}
                    className={`card ${selected.includes(c) ? "selected" : ""}`}
                    title={on ? "Selected to discard" : "Click to discard"}
                  >
                    {c}
                  </button>
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
}
