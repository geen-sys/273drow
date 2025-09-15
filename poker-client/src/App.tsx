import React, { useMemo, useState } from "react";

// ======== Minimal D2-7 Triple Draw Demo UI ========
// • Single-file React component (drop into a Next.js or Vite React app)
// • Talks to your running server on http://localhost:8787
// • Lets you: new table → deal → auto-run bots → act as p1 → draw → showdown → new hand
// • Click cards to select discards (max 3 per draw)
// ---------------------------------------------------

// --- Adjust this if your server runs elsewhere
const API_BASE = "http://localhost:8787";

// === derived flags ===
const isDrawPhase = debug?.mode === "draw";
const isBetPhase  = debug?.mode === "bet";

const isYourTurn  = useMemo(() => {
  // p1 の番なら currentSeat が "p1"
  return debug?.currentSeat === "p1";
}, [debug?.currentSeat]);

const canCheck = Boolean(state) && isBetPhase && isYourTurn && (state?.toCall ?? 0) === 0;
const canCall  = Boolean(state) && isBetPhase && isYourTurn && (state?.toCall ?? 0) > 0;
const canBet   = Boolean(state) && isBetPhase && isYourTurn && (state?.toCall ?? 0) === 0; // 簡易
const canRaise = Boolean(state) && isBetPhase && isYourTurn && (state?.toCall ?? 0) > 0 && (debug?.raises ?? 0) < (debug?.cap ?? 0);

// Draw は「ドローフェーズ かつ 自分の番 かつ 3枚まで選択」
const canDrawNow = Boolean(state) && isDrawPhase && isYourTurn && discards.length <= 3;

// Types for common responses
type Card =
  | "Ah" | "Ad" | "Ac" | "As" | "Kh" | "Kd" | "Kc" | "Ks" | "Qh" | "Qd" | "Qc" | "Qs"
  | "Jh" | "Jd" | "Jc" | "Js" | "Th" | "Td" | "Tc" | "Ts" | "9h" | "9d" | "9c" | "9s"
  | "8h" | "8d" | "8c" | "8s" | "7h" | "7d" | "7c" | "7s" | "6h" | "6d" | "6c" | "6s"
  | "5h" | "5d" | "5c" | "5s" | "4h" | "4d" | "4c" | "4s" | "3h" | "3d" | "3c" | "3s"
  | "2h" | "2d" | "2c" | "2s";

type PublicState = {
  tableId: string;
  heroSeatId: string;
  heroHand: Card[];
  pot: number;
  toCall: number;
  street: "pre" | "post1" | "post2" | "post3";
  actionHistory: { seatId: string; a: string; size?: number }[];
};

type DebugRound = {
  street: PublicState["street"];
  pot: number;
  currentBet: number;
  raises: number;
  cap: number;
  committed: Record<string, number>;
  currentSeat: string;
  mode?: "bet" | "draw"; // if implemented
  drawStart?: number;      // if implemented
};

export default function D27Demo() {
  const [tableId, setTableId] = useState<string>("");
  const [state, setState] = useState<PublicState | null>(null);
  const [debug, setDebug] = useState<DebugRound | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [discards, setDiscards] = useState<Card[]>([]);

  const heroHand = state?.heroHand ?? [];

// 変更後（drawフェーズかつ3枚まで）
const canDraw = useMemo(
  () => (debug?.mode === "draw") && discards.length <= 3,
  [debug?.mode, discards.length]
);

  function toggleDiscard(card: Card) {
    setDiscards((prev) => {
      const idx = prev.indexOf(card);
      if (idx >= 0) {
        const copy = prev.slice();
        copy.splice(idx, 1);
        return copy;
      }
      if (prev.length >= 3) return prev; // cap at 3
      return [...prev, card];
    });
  }

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
      setErr(e.message || String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }
    

  async function onNewTable() {
    const r = await callApi<{ tableId: string }>("/d27/table/new");
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
    refreshDebug();
  }

  async function refreshDebug() {
    if (!tableId) return;
    try {
      const dbg = await callApi<DebugRound>("/d27/debug/round", { tableId });
      setDebug(dbg);
    } catch (_) {}
  }

  async function onAutoRun() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/auto/run", { tableId });
    setState(st);
    refreshDebug();
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
    refreshDebug();
  }

  async function onDraw() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/hand/draw", {
      tableId,
      playerId: "p1",
      discard: discards,
    });
    setState(st);
    setDiscards([]);
    refreshDebug();
  }

  async function onShowdown() {
    if (!tableId) return;
    const r = await callApi<any>("/d27/showdown", { tableId });
    alert(`Winners: ${r.winners?.join(", ")}\nPot: ${r.pot}\nBest: ${r.best?.join(" ")}`);
    refreshDebug();
  }

  async function onNewHand() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/hand/new", { tableId });
    setState(st);
    setDiscards([]);
    refreshDebug();
  }

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 flex flex-col items-center p-6 gap-6">
      <div className="w-full max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight">Deuce-to-Seven Triple Draw — Minimal Client</h1>
        <p className="text-sm text-neutral-400">API: {API_BASE}</p>
      </div>

      {/* Controls */}
      <div className="w-full max-w-4xl grid grid-cols-2 md:grid-cols-3 gap-2">
        <button className="btn" onClick={onNewTable} disabled={loading}>New Table</button>
        <button className="btn" onClick={onDeal} disabled={!tableId || loading}>Deal</button>
        <button className="btn" onClick={onAutoRun} disabled={!tableId || loading}>Auto Run (to p1)</button>
        <button className="btn" onClick={() => act("check")} disabled={!state || loading}>Check</button>
        <button className="btn" onClick={() => act("call")} disabled={!state || loading}>Call</button>
        <button className="btn" onClick={() => act("bet")} disabled={!state || loading}>Bet</button>
        <button className="btn" onClick={() => act("raise")} disabled={!state || loading}>Raise</button>
        <button className="btn !bg-red-600 hover:!bg-red-700" onClick={() => act("fold")} disabled={!state || loading}>Fold</button>

        <button
          type="button"
          className="btn"
          onClick={onDraw}
          disabled={!state || loading || !canDraw}
          title={debug?.mode !== "draw" ? "You can only draw in the Draw phase" : undefined}
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

          {/* Hero Hand with discard toggles */}
          <div className="mt-4">
            <div className="text-sm text-neutral-400 mb-2">Click cards to select up to 3 for discard</div>
            <div className="text-xs mt-1">
              Phase: <span className="font-mono">{debug?.mode ?? "?"}</span>
              {debug?.mode !== "draw" && (
                <span className="ml-2 text-yellow-400">（現在はドロー不可：まずベットを進めてください）</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {heroHand.map((c) => {
                const on = discards.includes(c);
                return (
                  <button
                    key={c}
                    onClick={() => toggleDiscard(c)}
                    className={`px-3 py-2 rounded-xl border font-mono ${on ? "bg-yellow-600/30 border-yellow-600" : "bg-neutral-800 border-neutral-700 hover:bg-neutral-700"}`}
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

        {/* Debug (optional) */}
        {debug && (
          <div className="bg-neutral-900/60 rounded-2xl p-4 border border-neutral-800">
            <div className="text-lg font-medium mb-2">Debug</div>
            <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(debug, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Styles */}
      <style>{`
        .btn { @apply px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed; }
      `}</style>
    </div>
  );
}
