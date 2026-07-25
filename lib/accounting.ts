import type { Player, Transaction } from "./supabase";
import { formatTime } from "./utils";

// ─── Per-Player Balance ───────────────────────────────────────────────────────

export interface PlayerBalance {
  player: Player;
  totalBuyins: number;
  totalCashouts: number;
  netChips: number;
  lastActionType: "buyin" | "cashout" | null;
  hasPendingCashout: boolean;
}

export function computePlayerBalances(
  players: Player[],
  transactions: Transaction[]
): PlayerBalance[] {
  return players.map((player) => {
    const playerTxs = transactions
      .filter((t) => t.player_id === player.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const totalBuyins = playerTxs
      .filter((t) => t.type === "buyin")
      .reduce((sum, t) => sum + Number(t.chips), 0);

    const totalCashouts = playerTxs
      .filter((t) => t.type === "cashout")
      .reduce((sum, t) => sum + Number(t.chips), 0);

    const lastTx = playerTxs[playerTxs.length - 1];
    const lastActionType = lastTx?.type ?? null;
    const hasPendingCashout = totalBuyins > 0 && lastActionType === "buyin";

    return {
      player,
      totalBuyins,
      totalCashouts,
      netChips: totalCashouts - totalBuyins,
      lastActionType,
      hasPendingCashout,
    };
  });
}

// ─── Game Integrity Check ─────────────────────────────────────────────────────

export interface IntegrityResult {
  totalBuyins: number;
  totalCashouts: number;
  chipsOnTable: number;  // totalBuyins - totalCashouts (chips not yet cashed out)
  gap: number;
  isBalanced: boolean;
  suspectPlayers: PlayerBalance[];
}

export function checkIntegrity(
  playerBalances: PlayerBalance[],
  transactions: Transaction[]
): IntegrityResult {
  const totalBuyins = transactions
    .filter((t) => t.type === "buyin")
    .reduce((sum, t) => sum + Number(t.chips), 0);

  const totalCashouts = transactions
    .filter((t) => t.type === "cashout")
    .reduce((sum, t) => sum + Number(t.chips), 0);

  const gap = totalBuyins - totalCashouts;

  return {
    totalBuyins,
    totalCashouts,
    chipsOnTable: gap,
    gap,
    isBalanced: gap === 0,
    suspectPlayers: playerBalances.filter((pb) => pb.hasPendingCashout),
  };
}

// ─── Settle-Up Algorithm ──────────────────────────────────────────────────────

export interface Settlement {
  from: Player;
  to: Player;
  chips: number;
  rupees: number;
}

// chipRatio: ₹ per chip  (money = chips * chipRatio)
export function computeSettlements(
  playerBalances: PlayerBalance[],
  chipRatio: number
): Settlement[] {
  const settlements: Settlement[] = [];

  const creditors = playerBalances
    .filter((pb) => pb.netChips > 0)
    .map((pb) => ({ player: pb.player, chips: pb.netChips }))
    .sort((a, b) => b.chips - a.chips);

  const debtors = playerBalances
    .filter((pb) => pb.netChips < 0)
    .map((pb) => ({ player: pb.player, chips: -pb.netChips }))
    .sort((a, b) => b.chips - a.chips);

  let i = 0;
  let j = 0;

  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i];
    const debtor = debtors[j];
    const amount = Math.min(creditor.chips, debtor.chips);

    if (amount > 0) {
      settlements.push({
        from: debtor.player,
        to: creditor.player,
        chips: amount,
        rupees: amount * chipRatio,  // money = chips * ratio
      });
    }

    creditor.chips -= amount;
    debtor.chips -= amount;

    if (creditor.chips === 0) i++;
    if (debtor.chips === 0) j++;
  }

  return settlements;
}

// ─── Chart Data ───────────────────────────────────────────────────────────────

export interface ChartPoint {
  time: string;
  [key: string]: number | string;
}

export function computeChartData(
  players: Player[],
  transactions: Transaction[]
): ChartPoint[] {
  if (transactions.length === 0) return [];

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const balances: Record<string, number> = {};
  players.forEach((p) => { balances[p.id] = 0; });

  // Start point: everyone at 0
  const initial: ChartPoint = { time: "Start" };
  players.forEach((p) => { initial[p.name] = 0; });
  const points: ChartPoint[] = [initial];

  sorted.forEach((tx) => {
    const delta = tx.type === "cashout" ? Number(tx.chips) : -Number(tx.chips);
    balances[tx.player_id] = (balances[tx.player_id] ?? 0) + delta;

    const point: ChartPoint = { time: formatTime(tx.created_at) };
    players.forEach((p) => { point[p.name] = balances[p.id]; });
    points.push(point);
  });

  return points;
}
