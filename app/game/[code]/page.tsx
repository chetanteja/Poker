"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Plus, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Share2, ChevronRight, Clock, Users, RefreshCw, Check,
  Trash2, ShieldCheck, X as XIcon,
} from "lucide-react";
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
  type PlayerBalance, type IntegrityResult,
} from "@/lib/accounting";
import {
  getAdminToken, savePlayerId, getPlayerId,
} from "@/lib/identity";
import { formatChips, formatDateTime, cn } from "@/lib/utils";

const PLAYER_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6",
];

type UserRole = "admin" | "player" | "new_visitor";
type ActiveTab = "board" | "log";

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();

  // ─── Game data ──────────────────────────────────────────────────────────────
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingTxns, setPendingTxns] = useState<PendingTransaction[]>([]);

  // ─── UI state ───────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("board");
  const [updateFlash, setUpdateFlash] = useState(false);
  const txCountRef = useRef(0);

  // ─── Identity ───────────────────────────────────────────────────────────────
  const [role, setRole] = useState<UserRole | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);

  // ─── Modals ─────────────────────────────────────────────────────────────────
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txPlayer, setTxPlayer] = useState<Player | null>(null);
  const [txType, setTxType] = useState<TransactionType>("buyin");
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ─── Form state ─────────────────────────────────────────────────────────────
  const [playerName, setPlayerName] = useState("");
  const [txChips, setTxChips] = useState("");
  const [txNote, setTxNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // ─── Load data ───────────────────────────────────────────────────────────────

  const detectRole = useCallback(
    (g: Game, p: Player[]) => {
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
    },
    [code]
  );

  const loadData = useCallback(
    async (silent = false) => {
      try {
        const g = await getGameByCode(code);
        if (!g) {
          setError("Game not found.");
          setLoading(false);
          return;
        }
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
    },
    [code, detectRole]
  );

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Real-time subscriptions ─────────────────────────────────────────────────

  useEffect(() => {
    if (!game) return;

    const channel = supabase
      .channel(`game-${game.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "players",
        filter: `game_id=eq.${game.id}`,
      }, (payload) => {
        setPlayers((prev) => {
          if (prev.find((p) => p.id === (payload.new as Player).id)) return prev;
          return [...prev, payload.new as Player];
        });
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "transactions",
        filter: `game_id=eq.${game.id}`,
      }, async () => {
        const t = await getTransactions(game.id);
        if (t.length > txCountRef.current) {
          setUpdateFlash(true);
          setTimeout(() => setUpdateFlash(false), 2500);
        }
        txCountRef.current = t.length;
        setTransactions(t);
      })
      .on("postgres_changes", {
        event: "DELETE",
        schema: "public",
        table: "transactions",
        filter: `game_id=eq.${game.id}`,
      }, async () => {
        const t = await getTransactions(game.id);
        txCountRef.current = t.length;
        setTransactions(t);
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "pending_transactions",
        filter: `game_id=eq.${game.id}`,
      }, async () => {
        const pt = await getPendingTransactions(game.id);
        setPendingTxns(pt);
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "games",
        filter: `id=eq.${game.id}`,
      }, (payload) => {
        setGame(payload.new as Game);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [game]);

  // ─── Polling fallback (every 10s) ────────────────────────────────────────────

  useEffect(() => {
    if (!game) return;
    const interval = setInterval(() => loadData(true), 10000);
    return () => clearInterval(interval);
  }, [game, loadData]);

  // ─── Computed values ─────────────────────────────────────────────────────────

  const playerBalances: PlayerBalance[] = computePlayerBalances(players, transactions);
  const integrity: IntegrityResult = checkIntegrity(playerBalances, transactions);
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
    } catch {
      setFormError("Failed to join. Try again.");
    } finally {
      setSubmitting(false);
    }
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
    } catch {
      setFormError("Failed to add player.");
    } finally {
      setSubmitting(false);
    }
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

      const isOwnAction = currentPlayerId === txPlayer.id;

      if (isOwnAction) {
        // Admin acting on themselves — log directly, no approval needed
        await addTransaction(game.id, txPlayer.id, txType, chips, txNote || undefined);
      } else {
        // Acting on another player — create pending, wait for their approval
        await createPendingTransaction(game.id, txPlayer.id, txType, chips, txNote || undefined);
      }
      setTxModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to log transaction.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(pt: PendingTransaction) {
    try {
      await approvePendingTransaction(pt.id, pt.game_id, pt.player_id, pt.type, pt.chips, pt.note);
    } catch {
      /* real-time will reflect failure */
    }
  }

  async function handleDeny(pt: PendingTransaction) {
    try {
      await denyPendingTransaction(pt.id);
    } catch { /* noop */ }
  }

  async function handleDeleteTransaction(txId: string) {
    try {
      await deleteTransaction(txId);
    } catch { /* real-time will reflect */ }
    setDeleteConfirmId(null);
  }

  async function handleEndGame() {
    if (!game) return;
    setSubmitting(true);
    try {
      await endGame(game.id);
      router.push(`/game/${code}/summary`);
    } catch {
      setSubmitting(false);
    }
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

  // ─── Loading / error ──────────────────────────────────────────────────────────

  if (loading || role === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-zinc-500 animate-spin" />
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

  // ─── Join prompt (new visitor) ────────────────────────────────────────────────

  if (role === "new_visitor") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 gap-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white">{game.name}</h2>
          <p className="text-zinc-400 text-sm mt-1">You&apos;ve been invited to this game</p>
        </div>

        <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <h3 className="font-semibold text-white">Join as a player</h3>
          <form
            onSubmit={handleJoin}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="join-name">Your Name</Label>
              <Input
                id="join-name"
                placeholder="e.g. Priya"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                autoFocus
                required
              />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Joining…" : "Join Game"}
            </Button>
          </form>

          <div className="relative flex items-center py-1">
            <div className="flex-1 border-t border-zinc-800" />
            <span className="px-3 text-xs text-zinc-600">or</span>
            <div className="flex-1 border-t border-zinc-800" />
          </div>

          <Button
            variant="ghost"
            className="w-full text-zinc-500"
            onClick={() => {
              setRole("player");
              setCurrentPlayerId(null);
            }}
          >
            Watch only (no name)
          </Button>
        </div>
      </div>
    );
  }

  // ─── Main game view ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col max-w-2xl mx-auto">
      {/* Live update flash */}
      {updateFlash && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg animate-fade-in pointer-events-none">
          <RefreshCw className="w-3.5 h-3.5" />
          Updated
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white truncate max-w-[160px]">{game.name}</h1>
              {role === "admin" && (
                <span className="text-xs bg-indigo-900/60 text-indigo-300 border border-indigo-700 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> Admin
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 font-mono tracking-widest">{code}</p>
          </div>
          <div className="flex items-center gap-2">
            {game.status === "active" && (
              <Button variant="ghost" size="icon" onClick={shareGame} title="Share game">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              </Button>
            )}
            {role === "admin" && game.status === "active" && (
              <Button variant="outline" size="sm" onClick={() => setEndGameOpen(true)}>
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
        <IntegrityBanner integrity={integrity} />
      </header>

      {/* Pending approval banner — shown to player when admin sent them an action */}
      {myPendingTxns.length > 0 && (
        <div className="bg-amber-950/60 border-b border-amber-700/50 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
            Action requires your approval
          </p>
          {myPendingTxns.map((pt) => (
            <div key={pt.id} className="flex items-center justify-between gap-3">
              <p className="text-sm text-white">
                <span className={cn("font-semibold", pt.type === "buyin" ? "text-red-400" : "text-emerald-400")}>
                  {pt.type === "buyin" ? "Buyin" : "Cashout"}
                </span>{" "}
                of <span className="font-semibold">{formatChips(Number(pt.chips))} chips</span>
                {pt.note && <span className="text-zinc-400"> · {pt.note}</span>}
              </p>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="success" className="h-7 px-3 text-xs" onClick={() => handleApprove(pt)}>
                  <Check className="w-3.5 h-3.5 mr-1" /> Accept
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={() => handleDeny(pt)}>
                  <XIcon className="w-3.5 h-3.5 mr-1" /> Deny
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Admin view: show pending sent to others */}
      {role === "admin" && pendingTxns.filter((pt) => pt.player_id !== currentPlayerId).length > 0 && (
        <div className="bg-zinc-900/80 border-b border-zinc-800 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Waiting for approval
          </p>
          {pendingTxns
            .filter((pt) => pt.player_id !== currentPlayerId)
            .map((pt) => (
              <div key={pt.id} className="flex items-center justify-between">
                <p className="text-sm text-zinc-300">
                  <span className="text-white font-medium">{pt.player?.name}</span>
                  {" — "}
                  <span className={pt.type === "buyin" ? "text-red-400" : "text-emerald-400"}>
                    {pt.type === "buyin" ? "Buyin" : "Cashout"}
                  </span>{" "}
                  {formatChips(Number(pt.chips))} chips
                </p>
                <span className="text-xs text-zinc-600 italic">pending…</span>
              </div>
            ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-950 sticky top-[73px] z-10">
        <button
          onClick={() => setActiveTab("board")}
          className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === "board" ? "text-white border-b-2 border-indigo-500" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Users className="w-4 h-4" /> Players
        </button>
        <button
          onClick={() => setActiveTab("log")}
          className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === "log" ? "text-white border-b-2 border-indigo-500" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Clock className="w-4 h-4" /> Log
          {transactions.length > 0 && (
            <span className="bg-zinc-800 text-zinc-400 text-xs px-1.5 py-0.5 rounded-full">{transactions.length}</span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-4">
        {activeTab === "board" ? (
          <BoardTab
            game={game}
            playerBalances={playerBalances}
            role={role}
            currentPlayerId={currentPlayerId}
            onBuyin={(p) => openTxModal(p, "buyin")}
            onCashout={(p) => openTxModal(p, "cashout")}
            onAddPlayer={() => { setPlayerName(""); setFormError(""); setAddPlayerOpen(true); }}
          />
        ) : (
          <LogTab
            transactions={transactions}
            players={players}
            isAdmin={role === "admin"}
            onDeleteRequest={(id) => setDeleteConfirmId(id)}
          />
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* Add Player (admin only) */}
      <Dialog open={addPlayerOpen} onOpenChange={setAddPlayerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Player</DialogTitle>
            <DialogDescription>Add a player who isn&apos;t joining via link.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddPlayer} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="player-name">Name</Label>
              <Input
                id="player-name"
                placeholder="e.g. Rahul"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                autoFocus
                required
              />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setAddPlayerOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={submitting}>{submitting ? "Adding…" : "Add Player"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Transaction Modal */}
      <Dialog open={txModalOpen} onOpenChange={setTxModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {txType === "buyin" ? "Buy In" : "Cash Out"} — {txPlayer?.name}
            </DialogTitle>
            <DialogDescription>
              {txPlayer && currentPlayerId !== txPlayer.id
                ? `${txPlayer.name} will receive a notification to approve this.`
                : txType === "buyin"
                ? "Chips purchased from the dealer."
                : "Chips being returned to the dealer."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleTransaction} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="tx-chips">Chips</Label>
              <Input
                id="tx-chips"
                type="number"
                placeholder="e.g. 500"
                value={txChips}
                onChange={(e) => setTxChips(e.target.value)}
                min="1"
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tx-note">Note (optional)</Label>
              <Input
                id="tx-note"
                placeholder="e.g. re-buy after going all-in"
                value={txNote}
                onChange={(e) => setTxNote(e.target.value)}
              />
            </div>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setTxModalOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                className="flex-1"
                variant={txType === "buyin" ? "destructive" : "success"}
                disabled={submitting}
              >
                {submitting ? "Logging…" : txPlayer && currentPlayerId !== txPlayer.id ? "Send for Approval" : txType === "buyin" ? "Log Buyin" : "Log Cashout"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* End Game Modal */}
      <Dialog open={endGameOpen} onOpenChange={setEndGameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End Game?</DialogTitle>
            <DialogDescription>
              This will close the game and take you to the final summary.
              {!integrity.isBalanced && (
                <span className="block mt-2 text-amber-400 font-medium">
                  ⚠ {formatChips(integrity.gap)} chips unaccounted — consider logging missing cashouts first.
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

      {/* Delete / Undo Confirm Modal */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo Transaction?</DialogTitle>
            <DialogDescription>
              This will permanently remove this transaction from the ledger. The accounting will update immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => deleteConfirmId && handleDeleteTransaction(deleteConfirmId)}
            >
              Yes, Remove It
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Integrity Banner ─────────────────────────────────────────────────────────

function IntegrityBanner({ integrity }: { integrity: IntegrityResult }) {
  if (integrity.totalBuyins === 0) return null;

  if (integrity.isBalanced) {
    return (
      <div className="mt-2 flex items-center gap-2 text-emerald-400 text-xs">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span>All {formatChips(integrity.totalBuyins)} chips accounted for</span>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-amber-400 text-xs">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>
        {formatChips(integrity.gap)} chips unaccounted
        {integrity.suspectPlayers.length > 0 && (
          <> — check {integrity.suspectPlayers.map((p) => p.player.name).join(", ")}</>
        )}
      </span>
    </div>
  );
}

// ─── Board Tab ────────────────────────────────────────────────────────────────

function BoardTab({
  game,
  playerBalances,
  role,
  currentPlayerId,
  onBuyin,
  onCashout,
  onAddPlayer,
}: {
  game: Game;
  playerBalances: PlayerBalance[];
  role: UserRole;
  currentPlayerId: string | null;
  onBuyin: (p: Player) => void;
  onCashout: (p: Player) => void;
  onAddPlayer: () => void;
}) {
  return (
    <div className="space-y-3">
      {playerBalances.map((pb) => (
        <PlayerCard
          key={pb.player.id}
          pb={pb}
          chipsPerRupee={game.chips_per_rupee}
          isAdmin={role === "admin"}
          isOwnCard={pb.player.id === currentPlayerId}
          gameActive={game.status === "active"}
          onBuyin={() => onBuyin(pb.player)}
          onCashout={() => onCashout(pb.player)}
        />
      ))}

      {playerBalances.length === 0 && (
        <div className="text-center py-16 text-zinc-600">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No players yet.</p>
        </div>
      )}

      {role === "admin" && game.status === "active" && (
        <button
          onClick={onAddPlayer}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-zinc-800 text-zinc-500 hover:border-indigo-700 hover:text-indigo-400 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Player (without link)
        </button>
      )}
    </div>
  );
}

// ─── Player Card ──────────────────────────────────────────────────────────────

function PlayerCard({
  pb,
  chipsPerRupee,
  isAdmin,
  isOwnCard,
  gameActive,
  onBuyin,
  onCashout,
}: {
  pb: PlayerBalance;
  chipsPerRupee: number;
  isAdmin: boolean;
  isOwnCard: boolean;
  gameActive: boolean;
  onBuyin: () => void;
  onCashout: () => void;
}) {
  const { player, netChips, totalBuyins, totalCashouts, hasPendingCashout } = pb;
  const isWinner = netChips > 0;
  const isLoser = netChips < 0;
  const rupees = netChips / chipsPerRupee;

  return (
    <div
      className={cn(
        "rounded-xl border bg-zinc-900 p-4 transition-all",
        isOwnCard && "ring-1 ring-indigo-700/50",
        hasPendingCashout && gameActive
          ? "border-amber-700/60"
          : isWinner
          ? "border-emerald-800/60"
          : isLoser
          ? "border-red-900/60"
          : "border-zinc-800"
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md"
            style={{ backgroundColor: player.color }}
          >
            {player.name[0].toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white">{player.name}</span>
              {isOwnCard && <Badge variant="default">You</Badge>}
              {hasPendingCashout && gameActive && <Badge variant="warning">Missing cashout?</Badge>}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              In: {formatChips(totalBuyins)} · Out: {formatChips(totalCashouts)}
            </p>
          </div>
        </div>

        <div className="text-right">
          <div
            className={cn(
              "text-xl font-bold flex items-center gap-1 justify-end",
              isWinner ? "text-emerald-400" : isLoser ? "text-red-400" : "text-zinc-400"
            )}
          >
            {isWinner ? <TrendingUp className="w-4 h-4" /> : isLoser ? <TrendingDown className="w-4 h-4" /> : null}
            {netChips >= 0 ? "+" : ""}{formatChips(netChips)}
          </div>
          {chipsPerRupee !== 1 && (
            <p className={cn("text-xs mt-0.5", isWinner ? "text-emerald-600" : isLoser ? "text-red-600" : "text-zinc-600")}>
              {rupees >= 0 ? "+" : ""}₹{Math.abs(rupees).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          )}
        </div>
      </div>

      {isAdmin && gameActive && (
        <div className="flex gap-2 mt-3">
          <Button variant="destructive" size="sm" className="flex-1 text-xs" onClick={onBuyin}>
            Buyin{isOwnCard ? "" : " (needs approval)"}
          </Button>
          <Button variant="success" size="sm" className="flex-1 text-xs" onClick={onCashout}>
            Cashout{isOwnCard ? "" : " (needs approval)"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Log Tab ──────────────────────────────────────────────────────────────────

function LogTab({
  transactions,
  players,
  isAdmin,
  onDeleteRequest,
}: {
  transactions: Transaction[];
  players: Player[];
  isAdmin: boolean;
  onDeleteRequest: (id: string) => void;
}) {
  const [filterPlayerId, setFilterPlayerId] = useState<string>("all");

  const filtered = filterPlayerId === "all"
    ? transactions
    : transactions.filter((t) => t.player_id === filterPlayerId);

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-3">
      {players.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterPlayerId("all")}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0",
              filterPlayerId === "all" ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white"
            )}
          >
            All
          </button>
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilterPlayerId(p.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 flex items-center gap-1.5",
                filterPlayerId === p.id ? "bg-indigo-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white"
              )}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-16 text-zinc-600">
          <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No transactions yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((tx) => (
            <TransactionRow
              key={tx.id}
              transaction={tx}
              isAdmin={isAdmin}
              onDelete={() => onDeleteRequest(tx.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Transaction Row ──────────────────────────────────────────────────────────

function TransactionRow({
  transaction: tx,
  isAdmin,
  onDelete,
}: {
  transaction: Transaction;
  isAdmin: boolean;
  onDelete: () => void;
}) {
  const player = tx.player;
  const isBuyin = tx.type === "buyin";

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-zinc-900 border border-zinc-800 animate-slide-up group">
      <div className="flex items-center gap-3 min-w-0">
        {player && (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: player.color }}
          >
            {player.name[0].toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{player?.name ?? "Unknown"}</span>
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded font-medium",
                isBuyin ? "bg-red-900/40 text-red-400" : "bg-emerald-900/40 text-emerald-400"
              )}
            >
              {isBuyin ? "BUYIN" : "CASHOUT"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-zinc-500">{formatDateTime(tx.created_at)}</span>
            {tx.note && <span className="text-xs text-zinc-600 italic truncate">&ldquo;{tx.note}&rdquo;</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div
          className={cn(
            "text-base font-bold",
            isBuyin ? "text-red-400" : "text-emerald-400"
          )}
        >
          {isBuyin ? "-" : "+"}{formatChips(Number(tx.chips))}
        </div>
        {isAdmin && (
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-800 text-zinc-600 hover:text-red-400"
            title="Undo this transaction"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
