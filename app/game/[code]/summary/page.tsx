"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, TrendingUp, TrendingDown, ArrowRight,
  CheckCircle2, AlertTriangle, RefreshCw, Share2, Check, Minus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getGameByCode, getPlayers, getTransactions,
  type Game, type Player, type Transaction
} from "@/lib/supabase";
import {
  computePlayerBalances, checkIntegrity, computeSettlements,
  type PlayerBalance, type IntegrityResult, type Settlement
} from "@/lib/accounting";
import { formatChips, formatRupees, cn } from "@/lib/utils";

export default function SummaryPage() {
  const params = useParams();
  const router = useRouter();
  const code = (params.code as string).toUpperCase();

  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const g = await getGameByCode(code);
      if (!g) { setError("Game not found."); setLoading(false); return; }
      const [p, t] = await Promise.all([getPlayers(g.id), getTransactions(g.id)]);
      setGame(g);
      setPlayers(p);
      setTransactions(t);
    } catch {
      setError("Failed to load game.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error || "Game not found"}</p>
        <Button variant="outline" onClick={() => router.push("/")}>Go Home</Button>
      </div>
    );
  }

  const playerBalances = computePlayerBalances(players, transactions);
  const integrity = checkIntegrity(playerBalances, transactions);
  const settlements = computeSettlements(playerBalances, game.chips_per_rupee);

  // Sort: biggest winners first
  const sortedBalances = [...playerBalances].sort((a, b) => b.netChips - a.netChips);

  function shareSummary() {
    const lines = [
      `🃏 ${game!.name} — Final Results`,
      ``,
      ...sortedBalances.map((pb) => {
        const sign = pb.netChips >= 0 ? "+" : "";
        const rupees = pb.netChips / game!.chips_per_rupee;
        return `${pb.player.name}: ${sign}${formatChips(pb.netChips)} chips (${sign}₹${Math.abs(rupees).toFixed(0)})`;
      }),
      ``,
      `Settle up:`,
      ...settlements.map((s) => `${s.from.name} → ${s.to.name}: ₹${s.rupees.toFixed(0)}`),
    ];

    const text = lines.join("\n");
    if (navigator.share) {
      navigator.share({ title: game!.name, text });
    } else {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="min-h-screen max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/game/${code}`)}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <Button variant="outline" size="sm" onClick={shareSummary}>
          {copied ? (
            <><Check className="w-4 h-4 mr-1.5 text-emerald-400" />Copied!</>
          ) : (
            <><Share2 className="w-4 h-4 mr-1.5" />Share</>
          )}
        </Button>
      </div>

      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-white">{game.name}</h1>
        <p className="text-zinc-500 text-sm mt-1 font-mono tracking-widest">{code} · Final Summary</p>
      </div>

      {/* Integrity Status */}
      <IntegrityCard integrity={integrity} />

      {/* Player Results */}
      <section>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Results</h2>
        <div className="space-y-2">
          {sortedBalances.map((pb, i) => (
            <PlayerResultRow
              key={pb.player.id}
              pb={pb}
              chipsPerRupee={game.chips_per_rupee}
              rank={i + 1}
            />
          ))}
        </div>
      </section>

      {/* Settle Up */}
      {settlements.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Settle Up</h2>
          <div className="space-y-2">
            {settlements.map((s, i) => (
              <SettlementRow key={i} settlement={s} chipsPerRupee={game.chips_per_rupee} />
            ))}
          </div>
        </section>
      )}

      {settlements.length === 0 && playerBalances.length > 0 && (
        <div className="flex items-center gap-2 p-4 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-emerald-400 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          Everyone is even — no settlements needed!
        </div>
      )}

      {/* Game Stats */}
      <section>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Stats</h2>
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Buyins" value={formatChips(integrity.totalBuyins)} />
          <StatCard label="Transactions" value={String(transactions.length)} />
          <StatCard label="Players" value={String(players.length)} />
        </div>
      </section>

      <div className="pb-8" />
    </div>
  );
}

// ─── Integrity Card ───────────────────────────────────────────────────────────

function IntegrityCard({ integrity }: { integrity: IntegrityResult }) {
  if (integrity.totalBuyins === 0) return null;

  if (integrity.isBalanced) {
    return (
      <div className="flex items-center gap-3 p-4 bg-emerald-950/40 border border-emerald-800/50 rounded-xl">
        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
        <div>
          <p className="text-emerald-400 font-medium text-sm">Fully balanced</p>
          <p className="text-zinc-500 text-xs mt-0.5">
            All {formatChips(integrity.totalBuyins)} chips are accounted for.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-amber-950/40 border border-amber-700/50 rounded-xl space-y-2">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
        <div>
          <p className="text-amber-400 font-medium text-sm">
            {formatChips(integrity.gap)} chips unaccounted
          </p>
          <p className="text-zinc-500 text-xs mt-0.5">
            Total buyins ({formatChips(integrity.totalBuyins)}) ≠ Total cashouts ({formatChips(integrity.totalCashouts)})
          </p>
        </div>
      </div>
      {integrity.suspectPlayers.length > 0 && (
        <div className="ml-8 space-y-1">
          <p className="text-xs text-zinc-500 font-medium">Possible missing cashouts:</p>
          {integrity.suspectPlayers.map((pb) => (
            <p key={pb.player.id} className="text-xs text-amber-300">
              • {pb.player.name} — last action was a buyin, no cashout logged
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Player Result Row ────────────────────────────────────────────────────────

function PlayerResultRow({
  pb,
  chipsPerRupee,
  rank,
}: {
  pb: PlayerBalance;
  chipsPerRupee: number;
  rank: number;
}) {
  const { player, netChips, totalBuyins, totalCashouts } = pb;
  const isWinner = netChips > 0;
  const isLoser = netChips < 0;
  const rupees = netChips / chipsPerRupee;

  return (
    <div
      className={cn(
        "flex items-center justify-between p-4 rounded-xl border bg-zinc-900",
        isWinner ? "border-emerald-800/50" : isLoser ? "border-red-900/50" : "border-zinc-800"
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-zinc-600 text-sm font-mono w-4 text-center">{rank}</span>
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{ backgroundColor: player.color }}
        >
          {player.name[0].toUpperCase()}
        </div>
        <div>
          <p className="font-medium text-white text-sm">{player.name}</p>
          <p className="text-xs text-zinc-500">
            In {formatChips(totalBuyins)} · Out {formatChips(totalCashouts)}
          </p>
        </div>
      </div>
      <div className="text-right">
        <div
          className={cn(
            "text-lg font-bold flex items-center gap-1 justify-end",
            isWinner ? "text-emerald-400" : isLoser ? "text-red-400" : "text-zinc-400"
          )}
        >
          {isWinner ? <TrendingUp className="w-4 h-4" /> : isLoser ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
          {netChips >= 0 ? "+" : ""}{formatChips(netChips)}
        </div>
        {chipsPerRupee !== 1 && (
          <p className={cn("text-xs", isWinner ? "text-emerald-600" : isLoser ? "text-red-600" : "text-zinc-600")}>
            {rupees >= 0 ? "+" : ""}₹{Math.abs(rupees).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Settlement Row ───────────────────────────────────────────────────────────

function SettlementRow({
  settlement: s,
  chipsPerRupee,
}: {
  settlement: Settlement;
  chipsPerRupee: number;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-zinc-900">
      <div className="flex items-center gap-2 text-sm">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: s.from.color }}
        >
          {s.from.name[0].toUpperCase()}
        </div>
        <span className="font-medium text-white">{s.from.name}</span>
        <ArrowRight className="w-4 h-4 text-zinc-600" />
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
          style={{ backgroundColor: s.to.color }}
        >
          {s.to.name[0].toUpperCase()}
        </div>
        <span className="font-medium text-white">{s.to.name}</span>
      </div>
      <div className="text-right">
        <p className="font-bold text-white">{formatRupees(s.rupees)}</p>
        {chipsPerRupee !== 1 && (
          <p className="text-xs text-zinc-500">{formatChips(s.chips)} chips</p>
        )}
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}
