"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Plus, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Share2, ChevronRight, Clock, Users, RefreshCw, Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import {
  supabase, getGameByCode, getPlayers, getTransactions,
  addPlayer, addTransaction, endGame,
  type Game, type Player, type Transaction, type TransactionType
} from "@/lib/supabase";
import {
  computePlayerBalances, checkIntegrity,
  type PlayerBalance, type IntegrityResult
} from "@/lib/accounting";
import { formatChips, formatDateTime, cn } from "@/lib/utils";

// Player avatar colors
const PLAYER_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ef4444", "#14b8a6",
];

type ActiveTab = "board" | "log";

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();

  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("board");

  // Modals
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txPlayer, setTxPlayer] = useState<Player | null>(null);
  const [txType, setTxType] = useState<TransactionType>("buyin");
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [playerName, setPlayerName] = useState("");
  const [txChips, setTxChips] = useState("");
  const [txNote, setTxNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [updateFlash, setUpdateFlash] = useState(false);
  const txCountRef = useRef(0);

  // ─── Load data ───────────────────────────────────────────────────────────────

  const loadData = useCallback(async (silent = false) => {
    try {
      const g = await getGameByCode(code);
      if (!g) { setError("Game not found."); setLoading(false); return; }
      const [p, t] = await Promise.all([getPlayers(g.id), getTransactions(g.id)]);
      setGame(g);
      setPlayers(p);
      // Flash notification if new transactions came in silently
      if (silent && t.length > txCountRef.current) {
        setUpdateFlash(true);
        setTimeout(() => setUpdateFlash(false), 2500);
      }
      txCountRef.current = t.length;
      setTransactions(t);
    } catch {
      if (!silent) setError("Failed to load game.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [code]);

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
  // Catches updates if the WebSocket connection is unavailable.

  useEffect(() => {
    if (!game) return;
    const interval = setInterval(() => loadData(true), 10000);
    return () => clearInterval(interval);
  }, [game, loadData]);

  // ─── Computed values ─────────────────────────────────────────────────────────

  const playerBalances: PlayerBalance[] = computePlayerBalances(players, transactions);
  const integrity: IntegrityResult = checkIntegrity(playerBalances, transactions);

  // ─── Handlers ────────────────────────────────────────────────────────────────

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
      await addTransaction(game.id, txPlayer.id, txType, chips, txNote || undefined);
      setTxModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to log transaction.");
    } finally {
      setSubmitting(false);
    }
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

  // ─── Loading / Error ──────────────────────────────────────────────────────────

  if (loading) {
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

  return (
    <div className="min-h-screen flex flex-col max-w-2xl mx-auto">
      {/* Live update flash */}
      {updateFlash && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg animate-fade-in">
          <RefreshCw className="w-3.5 h-3.5" />
          Updated
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white truncate max-w-[160px]">{game.name}</h1>
            <p className="text-xs text-zinc-500 font-mono tracking-widest">{code}</p>
          </div>
          <div className="flex items-center gap-2">
            {game.status === "active" && (
              <Button variant="ghost" size="icon" onClick={shareGame} title="Share game">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              </Button>
            )}
            {game.status === "active" && (
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

        {/* Integrity Banner */}
        <IntegrityBanner integrity={integrity} />
      </header>

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
          <Clock className="w-4 h-4" /> Transaction Log
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
            onBuyin={(p) => openTxModal(p, "buyin")}
            onCashout={(p) => openTxModal(p, "cashout")}
            onAddPlayer={() => { setPlayerName(""); setFormError(""); setAddPlayerOpen(true); }}
          />
        ) : (
          <LogTab transactions={transactions} players={players} />
        )}
      </div>

      {/* Add Player Modal */}
      <Dialog open={addPlayerOpen} onOpenChange={setAddPlayerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Player</DialogTitle>
            <DialogDescription>Enter the player&apos;s name to add them to the game.</DialogDescription>
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
              <Button type="button" variant="outline" className="flex-1" onClick={() => setAddPlayerOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? "Adding…" : "Add Player"}
              </Button>
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
              {txType === "buyin"
                ? "Log chips purchased from the dealer."
                : "Log chips being returned to the dealer."}
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
              <Button type="button" variant="outline" className="flex-1" onClick={() => setTxModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                variant={txType === "buyin" ? "destructive" : "success"}
                disabled={submitting}
              >
                {submitting ? "Logging…" : txType === "buyin" ? "Log Buyin" : "Log Cashout"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* End Game Confirmation Modal */}
      <Dialog open={endGameOpen} onOpenChange={setEndGameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End Game?</DialogTitle>
            <DialogDescription>
              This will close the game and take you to the final summary with settle-up amounts.
              {!integrity.isBalanced && (
                <span className="block mt-2 text-amber-400 font-medium">
                  ⚠ There are {formatChips(integrity.gap)} chips unaccounted. Consider logging missing cashouts first.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setEndGameOpen(false)}>
              Keep Playing
            </Button>
            <Button variant="destructive" className="flex-1" onClick={handleEndGame} disabled={submitting}>
              {submitting ? "Ending…" : "End Game"}
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
  onBuyin,
  onCashout,
  onAddPlayer,
}: {
  game: Game;
  playerBalances: PlayerBalance[];
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
          gameActive={game.status === "active"}
          onBuyin={() => onBuyin(pb.player)}
          onCashout={() => onCashout(pb.player)}
        />
      ))}

      {playerBalances.length === 0 && (
        <div className="text-center py-16 text-zinc-600">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No players yet.</p>
          <p className="text-xs mt-1">Add the first player to get started.</p>
        </div>
      )}

      {game.status === "active" && (
        <button
          onClick={onAddPlayer}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-zinc-800 text-zinc-500 hover:border-indigo-700 hover:text-indigo-400 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add Player
        </button>
      )}
    </div>
  );
}

// ─── Player Card ──────────────────────────────────────────────────────────────

function PlayerCard({
  pb,
  chipsPerRupee,
  gameActive,
  onBuyin,
  onCashout,
}: {
  pb: PlayerBalance;
  chipsPerRupee: number;
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
        {/* Player info */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md"
            style={{ backgroundColor: player.color }}
          >
            {player.name[0].toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">{player.name}</span>
              {hasPendingCashout && gameActive && (
                <Badge variant="warning">Missing cashout?</Badge>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              In: {formatChips(totalBuyins)} · Out: {formatChips(totalCashouts)}
            </p>
          </div>
        </div>

        {/* Net balance */}
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

      {/* Action buttons */}
      {gameActive && (
        <div className="flex gap-2 mt-3">
          <Button variant="destructive" size="sm" className="flex-1 text-xs" onClick={onBuyin}>
            Buyin
          </Button>
          <Button variant="success" size="sm" className="flex-1 text-xs" onClick={onCashout}>
            Cashout
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Log Tab ──────────────────────────────────────────────────────────────────

function LogTab({ transactions, players }: { transactions: Transaction[]; players: Player[] }) {
  const [filterPlayerId, setFilterPlayerId] = useState<string>("all");

  const filtered = filterPlayerId === "all"
    ? transactions
    : transactions.filter((t) => t.player_id === filterPlayerId);

  // Show newest first
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="space-y-3">
      {/* Player filter */}
      {players.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
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
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: p.color }}
              />
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
            <TransactionRow key={tx.id} transaction={tx} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Transaction Row ──────────────────────────────────────────────────────────

function TransactionRow({ transaction: tx }: { transaction: Transaction }) {
  const player = tx.player;
  const isBuyin = tx.type === "buyin";

  return (
    <div className="flex items-center justify-between py-3 px-4 rounded-xl bg-zinc-900 border border-zinc-800 animate-slide-up">
      <div className="flex items-center gap-3">
        {player && (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: player.color }}
          >
            {player.name[0].toUpperCase()}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">{player?.name ?? "Unknown"}</span>
            <span
              className={cn(
                "text-xs px-1.5 py-0.5 rounded font-medium",
                isBuyin
                  ? "bg-red-900/40 text-red-400"
                  : "bg-emerald-900/40 text-emerald-400"
              )}
            >
              {isBuyin ? "BUYIN" : "CASHOUT"}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-zinc-500">{formatDateTime(tx.created_at)}</span>
            {tx.note && <span className="text-xs text-zinc-600 italic">&ldquo;{tx.note}&rdquo;</span>}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "text-base font-bold",
          isBuyin ? "text-red-400" : "text-emerald-400"
        )}
      >
        {isBuyin ? "-" : "+"}{formatChips(Number(tx.chips))}
      </div>
    </div>
  );
}
