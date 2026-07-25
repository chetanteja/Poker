import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing Supabase env vars. Copy .env.local.example to .env.local and fill in your credentials."
      );
    }
    _client = createClient(url, key);
  }
  return _client;
}

// Convenience proxy — lazily initialized, methods are bound to the real client.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = (client as unknown as Record<string, unknown>)[prop as string];
    if (typeof value === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (value as (...args: any[]) => unknown).bind(client);
    }
    return value;
  },
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type GameStatus = "active" | "ended";
export type TransactionType = "buyin" | "cashout";

export interface Game {
  id: string;
  code: string;
  name: string;
  chips_per_rupee: number;
  status: GameStatus;
  created_at: string;
}

export interface Player {
  id: string;
  game_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Transaction {
  id: string;
  game_id: string;
  player_id: string;
  type: TransactionType;
  chips: number;
  note: string | null;
  created_at: string;
  player?: Player;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getGameByCode(code: string): Promise<Game | null> {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("code", code.toUpperCase())
    .single();

  if (error) return null;
  return data;
}

export async function createGame(
  name: string,
  chipsPerRupee: number,
  code: string
): Promise<Game> {
  const { data, error } = await supabase
    .from("games")
    .insert({ name, chips_per_rupee: chipsPerRupee, code, status: "active" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function endGame(gameId: string): Promise<void> {
  const { error } = await supabase
    .from("games")
    .update({ status: "ended" })
    .eq("id", gameId);

  if (error) throw error;
}

export async function getPlayers(gameId: string): Promise<Player[]> {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function addPlayer(
  gameId: string,
  name: string,
  color: string
): Promise<Player> {
  const { data, error } = await supabase
    .from("players")
    .insert({ game_id: gameId, name, color })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getTransactions(gameId: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("*, player:players(*)")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function addTransaction(
  gameId: string,
  playerId: string,
  type: TransactionType,
  chips: number,
  note?: string
): Promise<Transaction> {
  const { data, error } = await supabase
    .from("transactions")
    .insert({ game_id: gameId, player_id: playerId, type, chips, note: note ?? null })
    .select("*, player:players(*)")
    .single();

  if (error) throw error;
  return data;
}
