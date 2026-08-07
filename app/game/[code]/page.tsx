"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle, CheckCircle2, Share2, ChevronRight,
  Clock, Users, RefreshCw, Check, Trash2, ShieldCheck,
  X as XIcon, BarChart2, TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  supabase, getGameByCode, getPlayers, getTransactions,
  addPlayer, addTransaction, endGame,
  getPendingTransactions, createPendingTransaction,
  approvePendingTransaction, denyPendingTransaction, deleteTransaction,
  type Game, type Player, type Transaction, type TransactionType,
  type PendingTransaction,
} from "@/lib/supabase";
import {
  computePlayerBalances, checkIntegrity,
  type PlayerBalance,
} from "@/lib/accounting";
import { getAdminToken, savePlayerId, getPlayerId } from "@/lib/identity";
import { formatChips, formatDateTime, cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6",
];

const SUITS = ["♠", "♥", "♦", "♣"];
const isSuitRed = (s: string) => s === "♥" || s === "♦";

type UserRole = "admin" | "player" | "new_visitor";
type ActiveTab = "board" | "stats" | "log";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();

  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingTxns, setPendingTxns] = useState<PendingTransaction[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("board");
  const [updateFlash, setUpdateFlash] = useState(false);
  const txCountRef = useRef(0);

  const [role, setRole] = useState<UserRole | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);

  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txPlayer, setTxPlayer] = useState<Player | null>(null);
  const [txType, setTxType] = useState<TransactionType>("buyin");
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [playerName, setPlayerName] = useState("");
  const [txChips, setTxChips] = useState("");
  const [txNote, setTxNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  // useRef is the synchronous guard — checked/set before any await, so rapid
  // second clicks are blocked even before React re-renders the disabled state.
  const inFlightRef = useRef<Set<string>>(new Set());
  const [inFlightIds, setInFlightIds] = useState<Set<string>>(new Set());

  // ─── Identity ───────────────────────────────────────────────────────────────

  const detectRole = useCallback((g: Game, p: Player[]) => {
    const storedAdminToken = getAdminToken(code);
    const storedPlayerId = getPlayerId(code);

    if (storedAdminToken && storedAdminToken === g.admin_token) {
      setRole("admin");
      setCurrentPlayerId(storedPlayerId);
      return;
    }
    if (storedPlayerId && p.find((pl) => pl.id === storedPlayerId)) {
      setRole("player");
      setCurrentPlayerId(storedPlayerId);
      return;
    }
    setRole("new_visitor");
  }, [code]);

  // ─── Load data ───────────────────────────────────────────────────────────────

  const loadData = useCallback(async (silent = false) => {
    try {
      const g = await getGameByCode(code);
      if (!g) { setError("Game not found."); setLoading(false); return; }
      const [p, t, pt] = await Promise.all([
        getPlayers(g.id),
        getTransactions(g.id),
        getPendingTransactions(g.id),
      ]);
      setGame(g);
      setPlayers(p);
      setPendingTxns(pt);
      if (silent && t.length > txCountRef.current) {
        setUpdateFlash(true);
        setTimeout(() => setUpdateFlash(false), 2500);
      }
      txCountRef.current = t.length;
      setTransactions(t);
      if (!silent) detectRole(g, p);
    } catch {
      if (!silent) setError("Failed to load game.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [code, detectRole]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Real-time ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!game) return;
    const channel = supabase
      .channel(`game-${game.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "players", filter: `game_id=eq.${game.id}` },
        (payload) => setPlayers((prev) => prev.find((p) => p.id === (payload.new as Player).id) ? prev : [...prev, payload.new as Player])
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions", filter: `game_id=eq.${game.id}` },
        async () => {
          const t = await getTransactions(game.id);
          if (t.length > txCountRef.current) { setUpdateFlash(true); setTimeout(() => setUpdateFlash(false), 2500); }
          txCountRef.current = t.length;
          setTransactions(t);
        }
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "transactions", filter: `game_id=eq.${game.id}` },
        async () => { const t = await getTransactions(game.id); txCountRef.current = t.length; setTransactions(t); }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_transactions", filter: `game_id=eq.${game.id}` },
        async () => { const pt = await getPendingTransactions(game.id); setPendingTxns(pt); }
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${game.id}` },
        (payload) => setGame(payload.new as Game)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [game]);

  useEffect(() => {
    if (!game) return;
    const interval = setInterval(() => loadData(true), 10000);
    return () => clearInterval(interval);
  }, [game, loadData]);

  // ─── Computed values ─────────────────────────────────────────────────────────

  const playerBalances = computePlayerBalances(players, transactions);
  const integrity = checkIntegrity(playerBalances, transactions);
  const myPendingTxns = pendingTxns.filter((pt) => pt.player_id === currentPlayerId);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!game || !playerName.trim()) return;
    setSubmitting(true);
    setFormError("");
    try {
      const color = PLAYER_COLORS[players.length % PLAYER_COLORS.length];
      const player = await addPlayer(game.id, playerName.trim(), color);
      savePlayerId(code, player.id);
      setCurrentPlayerId(player.id);
      setRole("player");
      setPlayers((prev) => [...prev, player]);
      setPlayerName("");
    } catch { setFormError("Failed to join. Try again."); }
    finally { setSubmitting(false); }
  }

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!game || !playerName.trim()) return;
    setSubmitting(true);
    setFormError("");
    try {
      const color = PLAYER_COLORS[players.length % PLAYER_COLORS.length];
      await addPlayer(game.id, playerName.trim(), color);
      setPlayerName("");
      setAddPlayerOpen(false);
    } catch { setFormError("Failed to add player."); }
    finally { setSubmitting(false); }
  }

  function openTxModal(player: Player, type: TransactionType) {
    setTxPlayer(player);
    setTxType(type);
    setTxChips("");
    setTxNote("");
    setFormError("");
    setTxModalOpen(true);
  }

  async function handleTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (!game || !txPlayer) return;
    setSubmitting(true);
    setFormError("");
    try {
      const chips = parseInt(txChips, 10);
      if (isNaN(chips) || chips <= 0) throw new Error("Enter a valid chip amount");

      if (txType === "cashout" && chips > integrity.chipsOnTable) {
        throw new Error(
          `Only ${formatChips(integrity.chipsOnTable)} chips are on the table right now.`
        );
      }

      if (role === "admin") {
        // Admin always logs directly, for any player
        await addTransaction(game.id, txPlayer.id, txType, chips, txNote || undefined);
      } else {
        // Player submits a request; admin will approve/deny
        await createPendingTransaction(game.id, txPlayer.id, txType, chips, txNote || undefined);
      }
      setTxModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to log transaction.");
    } finally { setSubmitting(false); }
  }

  async function handleApprove(pt: PendingTransaction) {
    // Ref check is synchronous — blocks a second click even before re-render
    if (inFlightRef.current.has(pt.id)) return;
    if (pt.type === "cashout" && Number(pt.chips) > integrity.chipsOnTable) {
      alert(`Cannot approve: only ${formatChips(integrity.chipsOnTable)} chips remain on the table.`);
      return;
    }
    inFlightRef.current.add(pt.id);
    setInFlightIds(new Set(inFlightRef.current)); // trigger re-render for disabled UI
    try {
      await approvePendingTransaction(pt.id, pt.game_id, pt.player_id, pt.type, pt.chips, pt.note);
    } catch { /* noop */ }
    finally {
      inFlightRef.current.delete(pt.id);
      setInFlightIds(new Set(inFlightRef.current));
    }
  }

  async function handleDeny(pt: PendingTransaction) {
    if (inFlightRef.current.has(pt.id)) return;
    inFlightRef.current.add(pt.id);
    setInFlightIds(new Set(inFlightRef.current));
    try { await denyPendingTransaction(pt.id); }
    catch { /* noop */ }
    finally {
      inFlightRef.current.delete(pt.id);
      setInFlightIds(new Set(inFlightRef.current));
    }
  }

  async function handleDeleteTransaction(txId: string) {
    try { await deleteTransaction(txId); } catch { /* noop */ }
    setDeleteConfirmId(null);
  }

  async function handleEndGame() {
    if (!game) return;
    setSubmitting(true);
    try { await endGame(game.id); router.push(`/game/${code}/summary`); }
    catch { setSubmitting(false); }
  }

  function shareGame() {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: game?.name, text: `Join game: ${code}`, url });
    } else {
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // ─── Loading / Error ──────────────────────────────────────────────────────────

  if (loading || role === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="text-5xl animate-bounce">🃏</div>
          <p className="text-emerald-300/60 text-sm">Dealing cards…</p>
        </div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-red-400 text-lg">{error || "Game not found"}</p>
        <Button variant="outline" onClick={() => router.push("/")}>Go Home</Button>
      </div>
    );
  }

  // ─── Join Prompt ──────────────────────────────────────────────────────────────

  if (role === "new_visitor") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-6">
        <div className="text-center">
          <div className="text-6xl mb-4">🃏</div>
          <h2 className="text-2xl font-bold text-white">{game.name}</h2>
          <p className="text-emerald-300/70 text-sm mt-1">You&apos;ve been invited to this poker game</p>
        </div>

        <div className="w-full max-w-sm bg-black/30 backdrop-blur-sm border border-white/10 rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold text-white text-center">Enter the table</h3>
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="join-name">Your Name</Label>
              <Input id="join-name" placeholder="e.g. Priya" value={playerName}
                onChange={(e) => setPlayerName(e.target.value)} autoFocus required />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={submitting}>
              {submitting ? "Joining…" : "Join Game"}
            </Button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-1 border-t border-white/10" />
            <span className="px-3 text-xs text-white/30">or</span>
            <div className="flex-1 border-t border-white/10" />
          </div>

          <Button variant="ghost" className="w-full text-white/40 hover:text-white/60"
            onClick={() => { setRole("player"); setCurrentPlayerId(null); }}>
            Watch only
          </Button>
        </div>
      </div>
    );
  }

  // ─── Main Game View ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col max-w-2xl mx-auto">
      {/* Update flash */}
      {updateFlash && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-full shadow-xl animate-fade-in pointer-events-none">
          <RefreshCw className="w-3.5 h-3.5" /> Updated
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 bg-black/40 backdrop-blur-md border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white truncate max-w-[160px]">{game.name}</h1>
              {role === "admin" && (
                <span className="text-xs bg-amber-900/60 text-amber-300 border border-amber-700/50 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1 shrink-0">
                  <ShieldCheck className="w-3 h-3" /> Admin
                </span>
              )}
            </div>
            <p className="text-xs text-emerald-400/50 font-mono tracking-widest">{code}</p>
          </div>
          <div className="flex items-center gap-2">
            {game.status === "active" && (
              <Button variant="ghost" size="icon" onClick={shareGame} className="text-white/60 hover:text-white">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              </Button>
            )}
            {role === "admin" && game.status === "active" && (
              <Button size="sm" onClick={() => setEndGameOpen(true)}
                className="bg-red-700/80 hover:bg-red-700 text-white border-0 text-xs">
                End Game
              </Button>
            )}
            {game.status === "ended" && (
              <Button variant="secondary" size="sm" onClick={() => router.push(`/game/${code}/summary`)}>
                Summary <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Chips on table — always visible */}
      {integrity.totalBuyins > 0 && (
        <div className="mx-3 mt-3 bg-black/30 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-white/10">
            <Stat
              label="On Table"
              value={formatChips(integrity.chipsOnTable)}
              highlight={integrity.chipsOnTable > 0}
              warn={integrity.chipsOnTable < 0}
            />
            <Stat label="Bought In" value={formatChips(integrity.totalBuyins)} />
            <Stat label="Cashed Out" value={formatChips(integrity.totalCashouts)} />
          </div>
          {!integrity.isBalanced && game.status === "ended" && (
            <div className="px-4 py-2 bg-amber-900/30 border-t border-amber-700/30 flex items-center gap-2 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {formatChips(integrity.gap)} chips unaccounted
              {integrity.suspectPlayers.length > 0 && (
                <> — check {integrity.suspectPlayers.map((p) => p.player.name).join(", ")}</>
              )}
            </div>
          )}
          {integrity.isBalanced && game.status === "ended" && (
            <div className="px-4 py-2 bg-emerald-900/30 border-t border-emerald-700/30 flex items-center gap-2 text-xs text-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Fully balanced
            </div>
          )}
        </div>
      )}

      {/* Player: show their own pending requests (read-only, waiting for admin) */}
      {role === "player" && myPendingTxns.length > 0 && (
        <div className="mx-3 mt-2 bg-amber-950/40 border border-amber-700/30 rounded-2xl px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            Waiting for admin approval
          </p>
          {myPendingTxns.map((pt) => (
            <div key={pt.id} className="flex items-center justify-between gap-3">
              <p className="text-sm text-white/80">
                <span className={cn("font-semibold", pt.type === "buyin" ? "text-red-400" : "text-emerald-400")}>
                  {pt.type === "buyin" ? "Buyin" : "Cashout"}
                </span>{" "}
                {formatChips(Number(pt.chips))} chips
                {pt.note && <span className="text-zinc-400"> · {pt.note}</span>}
              </p>
              <span className="text-xs text-amber-400/60 italic shrink-0">pending…</span>
            </div>
          ))}
        </div>
      )}

      {/* Admin: player requests awaiting approval */}
      {role === "admin" && pendingTxns.length > 0 && (
        <div className="mx-3 mt-2 bg-amber-950/60 border border-amber-700/40 rounded-2xl px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            Requests awaiting your approval
          </p>
          {pendingTxns.map((pt) => {
            const busy = inFlightIds.has(pt.id);
            return (
              <div key={pt.id} className="flex items-center justify-between gap-3">
                <p className="text-sm text-white/90 min-w-0">
                  <span className="font-semibold text-white">{pt.player?.name}</span>{" — "}
                  <span className={cn("font-medium", pt.type === "buyin" ? "text-red-400" : "text-emerald-400")}>
                    {pt.type === "buyin" ? "Buyin" : "Cashout"}
                  </span>{" "}
                  {formatChips(Number(pt.chips))} chips
                  {pt.note && <span className="text-zinc-400 text-xs"> · {pt.note}</span>}
                </p>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm"
                    className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => handleApprove(pt)}>
                    {busy ? "…" : <><Check className="w-3.5 h-3.5 mr-1" />Approve</>}
                  </Button>
                  <Button size="sm" variant="outline"
                    className="h-7 px-3 text-xs disabled:opacity-50"
                    disabled={busy}
                    onClick={() => handleDeny(pt)}>
                    {busy ? "…" : <><XIcon className="w-3.5 h-3.5 mr-1" />Deny</>}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex mt-3 mx-3 bg-black/30 rounded-xl overflow-hidden border border-white/10">
        {(["board", "stats", "log"] as ActiveTab[]).map((t) => {
          const icons = { board: <Users className="w-3.5 h-3.5" />, stats: <BarChart2 className="w-3.5 h-3.5" />, log: <Clock className="w-3.5 h-3.5" /> };
          const labels = { board: "Players", stats: "Stats", log: `Log${transactions.length ? ` (${transactions.length})` : ""}` };
          return (
            <button key={t} onClick={() => setActiveTab(t)}
              className={cn("flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors",
                activeTab === t ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
              )}>
              {icons[t]} {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 px-3 py-3">
        {activeTab === "board" && (
          <BoardTab
            game={game}
            playerBalances={playerBalances}
            role={role}
            currentPlayerId={currentPlayerId}
            onBuyin={(p) => openTxModal(p, "buyin")}
            onCashout={(p) => openTxModal(p, "cashout")}
            onAddPlayer={() => { setPlayerName(""); setFormError(""); setAddPlayerOpen(true); }}
          />
        )}
        {activeTab === "stats" && (
          <StatsTab players={players} transactions={transactions} playerBalances={playerBalances} chipRatio={game.chips_per_rupee} />
        )}
        {activeTab === "log" && (
          <LogTab
            transactions={transactions}
            players={players}
            isAdmin={role === "admin"}
            onDeleteRequest={(id) => setDeleteConfirmId(id)}
          />
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      <Dialog open={addPlayerOpen} onOpenChange={setAddPlayerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Player</DialogTitle>
            <DialogDescription>Add someone who isn&apos;t joining via link.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddPlayer} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input placeholder="e.g. Rahul" value={playerName} onChange={(e) => setPlayerName(e.target.value)} autoFocus required />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setAddPlayerOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={submitting}>{submitting ? "Adding…" : "Add Player"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={txModalOpen} onOpenChange={setTxModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={cn("text-2xl", txType === "buyin" ? "text-red-400" : "text-emerald-400")}>
                {txType === "buyin" ? "↓" : "↑"}
              </span>
              {txType === "buyin" ? "Buy In" : "Cash Out"} — {txPlayer?.name}
            </DialogTitle>
            <DialogDescription>
              {role === "player"
                ? "Your request will be sent to the admin for approval."
                : txType === "buyin" ? "Log chips purchased from the dealer." : "Log chips returned to the dealer."}
              {txType === "cashout" && integrity.chipsOnTable > 0 && (
                <span className="block mt-1 text-emerald-400/70">
                  {formatChips(integrity.chipsOnTable)} chips currently on the table.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTransaction} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Chips</Label>
              <Input type="number" placeholder="e.g. 500" value={txChips}
                onChange={(e) => setTxChips(e.target.value)} min="1" autoFocus required />
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Input placeholder="e.g. re-buy after all-in" value={txNote} onChange={(e) => setTxNote(e.target.value)} />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setTxModalOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1"
                style={{ backgroundColor: txType === "buyin" ? "#dc2626" : "#059669" }}
                disabled={submitting}>
                {submitting
                  ? (role === "player" ? "Sending…" : "Logging…")
                  : role === "player"
                    ? "Send Request"
                    : txType === "buyin" ? "Log Buyin" : "Log Cashout"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={endGameOpen} onOpenChange={setEndGameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End Game?</DialogTitle>
            <DialogDescription>
              This will close the game and take you to the final summary with settle-up amounts.
              {!integrity.isBalanced && (
                <span className="block mt-2 text-amber-400 font-medium">
                  ⚠ {formatChips(integrity.gap)} chips unaccounted. Consider logging missing cashouts first.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setEndGameOpen(false)}>Keep Playing</Button>
            <Button variant="destructive" className="flex-1" onClick={handleEndGame} disabled={submitting}>
              {submitting ? "Ending…" : "End Game"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo Transaction?</DialogTitle>
            <DialogDescription>This permanently removes the transaction. Balances update immediately.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" className="flex-1"
              onClick={() => deleteConfirmId && handleDeleteTransaction(deleteConfirmId)}>
              Yes, Remove It
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Stat Pill (chips on table panel) ────────────────────────────────────────

function Stat({ label, value, highlight, warn }: { label: string; value: string; highlight?: boolean; warn?: boolean }) {
  return (
    <div className="py-3 px-2 text-center">
      <p className="text-xs text-emerald-300/40 uppercase tracking-wider font-medium mb-0.5">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums",
        warn ? "text-red-400" : highlight ? "text-amber-300" : "text-white"
      )}>{value}</p>
    </div>
  );
}

// ─── Board Tab ────────────────────────────────────────────────────────────────

function BoardTab({ game, playerBalances, role, currentPlayerId, onBuyin, onCashout, onAddPlayer }: {
  game: Game; playerBalances: PlayerBalance[];
  role: UserRole; currentPlayerId: string | null;
  onBuyin: (p: Player) => void; onCashout: (p: Player) => void; onAddPlayer: () => void;
}) {
  return (
    <div className="space-y-3">
      {playerBalances.map((pb, i) => (
        <PlayerCard key={pb.player.id} pb={pb} suit={SUITS[i % 4]}
          chipsPerRupee={game.chips_per_rupee}
          isAdmin={role === "admin"}
          isOwnCard={pb.player.id === currentPlayerId}
          gameActive={game.status === "active"}
          onBuyin={() => onBuyin(pb.player)}
          onCashout={() => onCashout(pb.player)}
        />
      ))}

      {playerBalances.length === 0 && (
        <div className="text-center py-16 text-white/30">
          <div className="text-5xl mb-3">🃏</div>
          <p className="text-sm">No players yet.</p>
        </div>
      )}

      {role === "admin" && game.status === "active" && (
        <button onClick={onAddPlayer}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-white/15 text-white/30 hover:border-emerald-500/50 hover:text-emerald-400 transition-colors text-sm">
          + Add Player (without link)
        </button>
      )}
    </div>
  );
}

// ─── Player Card (playing card aesthetic) ────────────────────────────────────

function PlayerCard({ pb, suit, chipsPerRupee, isAdmin, isOwnCard, gameActive, onBuyin, onCashout }: {
  pb: PlayerBalance; suit: string; chipsPerRupee: number;
  isAdmin: boolean; isOwnCard: boolean; gameActive: boolean;
  onBuyin: () => void; onCashout: () => void;
}) {
  const { player, netChips, totalBuyins, totalCashouts, hasPendingCashout } = pb;
  const isWinner = netChips > 0;
  const isLoser = netChips < 0;
  const rupees = netChips * chipsPerRupee;
  const suitRed = isSuitRed(suit);

  return (
    <div className={cn(
      "playing-card rounded-2xl overflow-hidden animate-deal",
      isOwnCard && "ring-2 ring-indigo-400/60 ring-offset-1 ring-offset-transparent"
    )}>
      {/* Top suit-color bar */}
      <div className={cn("h-1.5", suitRed ? "bg-red-500" : "bg-zinc-800")} />

      <div className="p-4">
        <div className="flex items-start justify-between">
          {/* Left: suit + name */}
          <div className="flex items-center gap-3">
            <div className={cn("text-3xl font-bold leading-none select-none", suitRed ? "text-red-500" : "text-zinc-800")}>
              {suit}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-zinc-900 text-base">{player.name}</span>
                {isOwnCard && <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-[10px]">You</Badge>}
                {hasPendingCashout && gameActive && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">cashout?</Badge>}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                In {formatChips(totalBuyins)} · Out {formatChips(totalCashouts)}
              </p>
            </div>
          </div>

          {/* Right: balance */}
          <div className="text-right">
            <div className={cn("text-xl font-bold flex items-center gap-1 justify-end",
              isWinner ? "text-emerald-600" : isLoser ? "text-red-600" : "text-zinc-400"
            )}>
              {isWinner ? <TrendingUp className="w-4 h-4" /> : isLoser ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
              {netChips >= 0 ? "+" : ""}{formatChips(netChips)}
            </div>
            {chipsPerRupee !== 0 && (
              <p className={cn("text-xs mt-0.5", isWinner ? "text-emerald-500" : isLoser ? "text-red-500" : "text-zinc-400")}>
                {rupees >= 0 ? "+" : ""}₹{Math.abs(rupees).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </p>
            )}
          </div>
        </div>

        {/* Action buttons: admin on any card (direct), player on own card (request) */}
        {(isAdmin || isOwnCard) && gameActive && (
          <div className="flex gap-2 mt-3">
            <button onClick={onBuyin}
              className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all active:scale-95 bg-red-500 hover:bg-red-600 shadow-sm">
              {isAdmin ? "Buyin" : "Request Buyin"}
            </button>
            <button onClick={onCashout}
              className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all active:scale-95 bg-emerald-500 hover:bg-emerald-600 shadow-sm">
              {isAdmin ? "Cashout" : "Request Cashout"}
            </button>
          </div>
        )}
      </div>

      {/* Bottom accent */}
      <div className={cn("h-0.5 opacity-30", suitRed ? "bg-red-500" : "bg-zinc-600")} />
    </div>
  );
}

// ─── Stats Tab (per-player) ───────────────────────────────────────────────────

function StatsTab({ players, transactions, playerBalances, chipRatio }: {
  players: Player[];
  transactions: Transaction[];
  playerBalances: PlayerBalance[];
  chipRatio: number;
}) {
  const [selectedId, setSelectedId] = useState(players[0]?.id ?? "");

  const player = players.find((p) => p.id === selectedId);
  const pb = playerBalances.find((b) => b.player.id === selectedId);
  const suitIdx = players.findIndex((p) => p.id === selectedId);
  const suit = SUITS[suitIdx % 4];
  const sRed = isSuitRed(suit);

  const playerTxns = transactions
    .filter((t) => t.player_id === selectedId)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // Build running balance chart data
  let running = 0;
  const chartData: { label: string; balance: number }[] = [{ label: "Start", balance: 0 }];
  playerTxns.forEach((tx) => {
    running += tx.type === "cashout" ? Number(tx.chips) : -Number(tx.chips);
    chartData.push({ label: tx.created_at.slice(11, 16), balance: running });
  });

  const allBalances = chartData.map((d) => d.balance);
  const peak    = Math.max(0, ...allBalances);
  const trough  = Math.min(0, ...allBalances);
  const buyinTxns   = playerTxns.filter((t) => t.type === "buyin");
  const cashoutTxns = playerTxns.filter((t) => t.type === "cashout");
  const biggestBuyin   = buyinTxns.reduce((m, t) => Math.max(m, Number(t.chips)), 0);
  const biggestCashout = cashoutTxns.reduce((m, t) => Math.max(m, Number(t.chips)), 0);
  const isWinning = (pb?.netChips ?? 0) > 0;
  const gradId = `grad-${selectedId}`;

  if (players.length === 0) {
    return (
      <div className="text-center py-16 text-white/30">
        <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Add players to see stats.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Player selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {players.map((p, i) => {
          const s = SUITS[i % 4];
          const sr = isSuitRed(s);
          const isSel = p.id === selectedId;
          return (
            <button key={p.id} onClick={() => setSelectedId(p.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0",
                isSel
                  ? "bg-white text-zinc-900 shadow-lg scale-105"
                  : "bg-black/25 text-white/50 hover:text-white/80 border border-white/10"
              )}>
              <span className={cn("text-sm", sr ? (isSel ? "text-red-500" : "text-red-400") : (isSel ? "text-zinc-700" : "text-white/50"))}>
                {s}
              </span>
              {p.name}
            </button>
          );
        })}
      </div>

      {!player || !pb ? null : playerTxns.length === 0 ? (
        <div className="text-center py-12 text-white/30 bg-black/20 rounded-2xl border border-white/8">
          <p className="text-sm">No transactions yet for {player.name}.</p>
        </div>
      ) : (
        <>
          {/* Area chart */}
          <div className="bg-black/30 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={cn("text-2xl", sRed ? "text-red-400" : "text-white/80")}>{suit}</span>
                <p className="text-sm font-semibold text-white">{player.name}</p>
              </div>
              <span className={cn("text-lg font-bold",
                isWinning ? "text-emerald-400" : pb.netChips < 0 ? "text-red-400" : "text-white/40"
              )}>
                {pb.netChips >= 0 ? "+" : ""}{formatChips(pb.netChips)}
                {chipRatio > 0 && (
                  <span className="text-xs font-normal ml-1 opacity-60">
                    (₹{Math.abs(pb.netChips * chipRatio).toLocaleString("en-IN", { maximumFractionDigits: 0 })})
                  </span>
                )}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData} margin={{ top: 10, right: 5, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={isWinning ? "#10b981" : "#ef4444"} stopOpacity={0.45} />
                    <stop offset="95%" stopColor={isWinning ? "#10b981" : "#ef4444"} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.22)", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.22)", fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#071e0f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", padding: "8px 12px" }}
                  labelStyle={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => {
                    const n = Number(v ?? 0);
                    return [`${n >= 0 ? "+" : ""}${formatChips(n)}`, "Balance"];
                  }}
                />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.18)" strokeDasharray="5 4" />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke={isWinning ? "#10b981" : "#ef4444"}
                  strokeWidth={2.5}
                  fill={`url(#${gradId})`}
                  dot={{ r: 4.5, fill: isWinning ? "#10b981" : "#ef4444", strokeWidth: 2, stroke: "#071e0f" }}
                  activeDot={{ r: 6.5, strokeWidth: 0, fill: isWinning ? "#34d399" : "#f87171" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Peak Balance" value={`+${formatChips(peak)}`} sub={chipRatio > 0 ? `+₹${(peak * chipRatio).toFixed(0)}` : undefined} color="emerald" />
            <StatBox label="Lowest Point" value={formatChips(trough)} sub={chipRatio > 0 ? `₹${(trough * chipRatio).toFixed(0)}` : undefined} color={trough < 0 ? "red" : "zinc"} />
            <StatBox
              label={`Buyins · ${buyinTxns.length}×`}
              value={formatChips(pb.totalBuyins)}
              sub={chipRatio > 0 ? `₹${(pb.totalBuyins * chipRatio).toFixed(0)}` : undefined}
              color="red"
            />
            <StatBox
              label={`Cashouts · ${cashoutTxns.length}×`}
              value={formatChips(pb.totalCashouts)}
              sub={chipRatio > 0 ? `₹${(pb.totalCashouts * chipRatio).toFixed(0)}` : undefined}
              color="emerald"
            />
            {biggestBuyin > 0 && (
              <StatBox label="Biggest Buyin" value={formatChips(biggestBuyin)} color="red" />
            )}
            {biggestCashout > 0 && (
              <StatBox label="Biggest Cashout" value={formatChips(biggestCashout)} color="emerald" />
            )}
            <StatBox
              label="Total Transactions"
              value={String(playerTxns.length)}
              color="zinc"
            />
            <StatBox
              label="Net Position"
              value={`${pb.netChips >= 0 ? "+" : ""}${formatChips(pb.netChips)}`}
              color={isWinning ? "emerald" : pb.netChips < 0 ? "red" : "zinc"}
            />
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, sub, color }: {
  label: string; value: string; sub?: string;
  color: "emerald" | "red" | "zinc";
}) {
  const clr = { emerald: "text-emerald-400", red: "text-red-400", zinc: "text-white/40" }[color];
  return (
    <div className="bg-black/25 rounded-xl border border-white/8 p-3 backdrop-blur-sm">
      <p className="text-xs text-white/30 mb-1">{label}</p>
      <p className={cn("text-lg font-bold leading-tight", clr)}>{value}</p>
      {sub && <p className={cn("text-xs mt-0.5 opacity-60", clr)}>{sub}</p>}
    </div>
  );
}

// ─── Log Tab ──────────────────────────────────────────────────────────────────

function LogTab({ transactions, players, isAdmin, onDeleteRequest }: {
  transactions: Transaction[]; players: Player[];
  isAdmin: boolean; onDeleteRequest: (id: string) => void;
}) {
  const [filterPlayerId, setFilterPlayerId] = useState<string>("all");
  const filtered = filterPlayerId === "all" ? transactions : transactions.filter((t) => t.player_id === filterPlayerId);
  const sorted = [...filtered].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="space-y-3">
      {players.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {["all", ...players.map((p) => p.id)].map((id) => {
            const p = players.find((pl) => pl.id === id);
            return (
              <button key={id} onClick={() => setFilterPlayerId(id)}
                className={cn("px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 flex items-center gap-1.5",
                  filterPlayerId === id ? "bg-white/20 text-white" : "bg-black/20 text-white/40 hover:text-white/70"
                )}>
                {p && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />}
                {id === "all" ? "All" : p?.name}
              </button>
            );
          })}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-white/30">
          <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No transactions yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((tx) => (
            <TransactionRow key={tx.id} transaction={tx} isAdmin={isAdmin} onDelete={() => onDeleteRequest(tx.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Transaction Row ──────────────────────────────────────────────────────────

function TransactionRow({ transaction: tx, isAdmin, onDelete }: {
  transaction: Transaction; isAdmin: boolean; onDelete: () => void;
}) {
  const player = tx.player;
  const isBuyin = tx.type === "buyin";

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-black/25 border border-white/8 animate-slide-up group backdrop-blur-sm">
      <div className="flex items-center gap-3 min-w-0">
        {player && (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: player.color }}>
            {player.name[0].toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{player?.name ?? "Unknown"}</span>
            <span className={cn("text-xs px-1.5 py-0.5 rounded font-medium",
              isBuyin ? "bg-red-900/50 text-red-400" : "bg-emerald-900/50 text-emerald-400"
            )}>
              {isBuyin ? "BUYIN" : "CASHOUT"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-white/30">{formatDateTime(tx.created_at)}</span>
            {tx.note && <span className="text-xs text-white/20 italic truncate">&ldquo;{tx.note}&rdquo;</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("text-base font-bold", isBuyin ? "text-red-400" : "text-emerald-400")}>
          {isBuyin ? "-" : "+"}{formatChips(Number(tx.chips))}
        </span>
        {isAdmin && (
          <button onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10 text-white/30 hover:text-red-400"
            title="Undo">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
