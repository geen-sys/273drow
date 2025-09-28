import { useState } from "react";

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

  const [result, setResult] = useState<ShowdownResult | null>(null);

  // ---------- 便利参照 ----------
  const heroHand = state?.heroHand ?? [];

  const [revealedHands, setRevealedHands] = useState<Record<string, Card[]> | null>(null);

  // ---------- 共通POST（ボディなしはヘッダーを付けない：空JSONエラー回避） ----------
  async function callApi<T = any>(path: string, body?: unknown): Promise<T> {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : JSON.stringify({}),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try { const j = JSON.parse(text); if (j?.message) msg = j.message; } catch {}
        throw new Error(`${res.status} ${res.statusText} - ${msg}`);
      }
      try { return JSON.parse(text); } catch { return text as any; }
    } catch (e: any) {
      const m = e?.message ?? String(e);
      setErr(m);            // ★ 画面下部のエラーパネルに表示される想定
      throw e;
    } finally {
      setLoading(false);
    }
  }
  
  

async function onNewTable() {
  try {
    const { tableId } = await callApi<{ tableId: string }>("/d27/table/new", { seats: 4 });
    setTableId(tableId);
    setState(null);
    setDebug(null);
    setRevealedHands(null);
  } catch {}
}

async function onDeal() {
  if (!tableId) return alert("No table. New Table first.");
  try {
    const ps = await callApi<PublicState>("/d27/hand/deal", { tableId }); // ★ tableId を必ず送る
    setState(ps);
    const dbg = await callApi<DebugRound>("/d27/debug/round", { tableId });
    setDebug(dbg);
  } catch {}
}

async function onAutoRun() {
  if (!tableId) return alert("No table. New Table first.");
  try {
    await callApi("/d27/auto/run", { tableId }); // ★ tableId を必ず送る
    const ps = await callApi<PublicState>("/d27/state", { tableId, heroId: "p1" }).catch(() => null);
    if (ps) setState(ps);
    const dbg = await callApi<DebugRound>("/d27/debug/round", { tableId });
    setDebug(dbg);
  } catch {}
}


  async function onNewHand() {
    if (!tableId) return;
    const st = await callApi<PublicState>("/d27/hand/new", { tableId });
    setState(st);
    setDiscards([]);
    setResult(null);       // ★ 前回の結果を消す
    setRevealedHands(null);
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
    } catch {}
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
    await refreshDebug();
  }

  async function onShowdown() {
    if (!tableId) return;
    const r = await callApi<any>("/d27/showdown", { tableId });
    // 画面内パネル表示用（既存の result を使っているならそれも維持OK）
    setResult(r);
    // ★ 全員の手札
    if (r.hands) setRevealedHands(r.hands);
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
      <div className="w-full max-w-6xl">
      <h1 className="game-title">
          2–7 Triple Draw
          <span className="game-sub"> prototype </span>
        </h1>
        <p className="text-sm text-neutral-400">API: <span className="font-mono">{API_BASE || "(proxy)"}</span></p>
      </div>

      {/* Controls */}
      <div className="w-full max-w-6xl grid grid-cols-2 md:grid-cols-3 gap-2">
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
        <div className="w-full max-w-6xl bg-red-950/50 border border-red-700 text-red-200 rounded-xl p-3">
          <div className="font-semibold">Error</div>
          <div className="text-sm whitespace-pre-wrap">{err}</div>
        </div>
      )}

      {/* Table + Hand */}
      <div className="w-full max-w-6xl grid gap-4">
        <div className="bg-neutral-900/60 rounded-2xl p-4 border border-neutral-800">
          {/* 横並びのサマリー（モバイルは自動折返し） */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <div className="stat"><span className="stat-k">テーブル</span><span className="stat-v font-mono">{tableId || "—"}</span></div>
            <div className="stat"><span className="stat-k">ストリート</span><span className="stat-v font-mono">{state?.street ?? "—"}</span></div>
            <div className="stat"><span className="stat-k">ポット</span><span className="stat-v font-mono">{state?.pot ?? 0}</span></div>
            <div className="stat"><span className="stat-k">コール額</span><span className="stat-v font-mono">{state?.toCall ?? 0}</span></div>
            <div className="stat"><span className="stat-k">席</span><span className="stat-v font-mono">{state?.heroSeatId ?? "p1"}</span></div>
            <div className="stat"><span className="stat-k">フェーズ</span><span className="stat-v font-mono">{debug?.mode ?? "—"}</span></div>
          </div>


          {/* 状況ガイド（ショウダウン優先） */}
          <div className="mt-3 p-3 rounded-xl border border-neutral-800 bg-neutral-900/60">
            <div className="text-sm">
              <span className="mr-2">フェーズ: <span className="font-mono">{debug?.mode ?? "—"}</span></span>
              <span className="mr-2">手番: <span className="font-mono">{debug?.currentSeat ?? "—"}</span></span>
              <span className="mr-2">レイズ数: <span className="font-mono">{debug?.raises ?? 0}/{debug?.cap ?? "?"}</span></span>
              <span className="mr-2">現在ベット: <span className="font-mono">{debug?.currentBet ?? 0}</span></span>
              <span className="mr-2">ポット: <span className="font-mono">{state?.pot ?? 0}</span></span>
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
            <div className="text-sm text-neutral-400 mb-2">捨て札にするカードを最大 3 枚までクリック</div>
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

        {/* === Opponents (showdown only) === */}
        {revealedHands && (
          <div className="bg-neutral-900/60 rounded-2xl p-4 border border-neutral-800">
            <div className="text-lg font-medium mb-3">ショウダウン結果（相手の手札）</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {["p2","p3","p4"].map((pid) => {
                const cards = (revealedHands?.[pid] ?? []) as Card[];
                return (
                  <div key={pid} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="font-medium">{pid}</div>
                    </div>
                    {/* ★ 横並びで大きいカードを5枚 */}
                    <div className="big-hand-row">
                      {cards.map((c, i) => (
                        <BigCard key={`${pid}-${i}-${c}`} card={c}/>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action history */}
        <div className="bg-neutral-900/60 rounded-2xl p-4 border border-neutral-800">
          <div className="text-lg font-medium mb-2">このラウンドのアクション履歴</div>
          <div className="flex flex-col gap-1 text-sm max-h-48 overflow-auto">
            {(state?.actionHistory ?? []).length === 0 && (
              <div className="text-neutral-500">（まだアクションはありません）</div>
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
        .stat{
          display:inline-flex;align-items:center;gap:.35rem;
          padding:.25rem .5rem;border:1px solid #303030;
          background:#0b0b0b;border-radius:.5rem;
        }
        .stat-k{ color:#9ca3af; font-size:.75rem; }
        .stat-v{ margin-left:.1rem; }
        @media (min-width:1024px){
          .stat{ padding:.35rem .6rem; }
        }       
        .hand-row { display: flex; flex-direction: row; align-items: center; gap: 4px; }
        .drop-shadow { filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
        .big-hand-row { display:flex; flex-direction:row; align-items:center; gap:8px; flex-wrap:wrap; }
        .big-card { border-radius: 10px; }
        .drop-shadow { filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
      `}</style>
    </div>
  );
  
  function splitCard(c: string) {
    const r = c[0] === "T" ? "10" : c[0];         // T -> 10
    const s = c[c.length - 1];                    // s|h|d|c
    const isRed = s === "h" || s === "d";
    return { rank: r, suit: s, suitChar: suitGlyph[s], isRed };
  }
}


function BigCard({ card }: { card: Card }) {
  const r = card[0]; // 'A','K','Q','J','T','9'...'2'
  const s = card[1]; // 'h','d','c','s'
  const suitMap: Record<string, string> = { h: "♥", d: "♦", c: "♣", s: "♠" };
  const isRed = s === "h" || s === "d";

  return (
    <svg width="72" height="100" viewBox="0 0 72 100" className="big-card drop-shadow">
      <rect x="0.75" y="0.75" width="70.5" height="98.5" rx="8" fill="#ffffff"/>
      <rect x="0.75" y="0.75" width="70.5" height="98.5" rx="8" stroke="#d1d5db" fill="none"/>
      {/* 左上 */}
      <text x="6" y="18" fontSize="18" fontWeight="700" fill={isRed ? "#dc2626" : "#111827"}>{r}</text>
      <text x="6" y="34" fontSize="18" fill={isRed ? "#dc2626" : "#111827"}>{suitMap[s]}</text>
      {/* 右下（反転） */}
      <g transform="translate(66,94) rotate(180)">
        <text x="0" y="0" fontSize="18" fontWeight="700" textAnchor="end" fill={isRed ? "#dc2626" : "#111827"}>{r}</text>
        <text x="0" y="16" fontSize="18" textAnchor="end" fill={isRed ? "#dc2626" : "#111827"}>{suitMap[s]}</text>
      </g>
      {/* 中央の大きいスート薄色 */}
      <text x="36" y="56" textAnchor="middle" fontSize="36" opacity="0.15" fill={isRed ? "#ef4444" : "#111827"}>
        {suitMap[s]}
      </text>
    </svg>
  );
}
