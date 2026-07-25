import type { Player, Transaction } from "./supabase";

// ─── Per-Player Balance ───────────────────────────────────────────────────────

export interface PlayerBalance {
  player: Player;
  totalBuyins: number;
  totalCashouts: number;
  netChips: number; // positive = winner, negative = still owes chips
  lastActionType: "buyin" | "cashout" | null;
  hasPendingCashout: boolean; // last action was a buyin with no cashout after
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

    // A player has a pending cashout if they have buyins and the last
    // logged action is a buyin (i.e., no cashout has been logged since).
    const hasPendingCashout =
      totalBuyins > 0 && lastActionType === "buyin";

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
  gap: number; // totalBuyins - totalCashouts (should be 0 at end of game)
  isBalanced: boolean;
  suspectPlayers: PlayerBalance[]; // players whose last action is buyin
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
    gap,
    isBalanced: gap === 0,
    suspectPlayers: playerBalances.filter((pb) => pb.hasPendingCashout),
  };
}

// ─── Settle-Up Algorithm ──────────────────────────────────────────────────────
// Minimal number of transactions to settle debts between players.
// Uses a greedy approach: pair the biggest creditor with the biggest debtor.

export interface Settlement {
  from: Player; // owes chips
  to: Player;   // is owed chips
  chips: number;
  rupees: number;
}

export function computeSettlements(
  playerBalances: PlayerBalance[],
  chipsPerRupee: number
): Settlement[] {
  const settlements: Settlement[] = [];

  // Separate winners (positive net) and losers (negative net)
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
        rupees: amount / chipsPerRupee,
      });
    }

    creditor.chips -= amount;
    debtor.chips -= amount;

    if (creditor.chips === 0) i++;
    if (debtor.chips === 0) j++;
  }

  return settlements;
}
