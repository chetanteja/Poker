"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spade, ArrowRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createGame, getGameByCode } from "@/lib/supabase";
import { generateGameCode } from "@/lib/utils";

export default function HomePage() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");

  // Create game form
  const [gameName, setGameName] = useState("");
  const [chipsPerRupee, setChipsPerRupee] = useState("1");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Join game form
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!gameName.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const rate = parseFloat(chipsPerRupee);
      if (isNaN(rate) || rate <= 0) throw new Error("Invalid chips per rupee");
      const code = generateGameCode();
      const game = await createGame(gameName.trim(), rate, code);
      router.push(`/game/${game.code}`);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Failed to create game. Check your connection.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinError("");
    try {
      const game = await getGameByCode(joinCode.trim());
      if (!game) throw new Error("Game not found. Check the code and try again.");
      router.push(`/game/${game.code}`);
    } catch (err: unknown) {
      setJoinError(err instanceof Error ? err.message : "Failed to join game.");
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      {/* Logo */}
      <div className="flex flex-col items-center mb-10">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-900/50">
          <Spade className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">PokerLedger</h1>
        <p className="text-zinc-400 mt-2 text-center max-w-xs">
          Real-time chip accounting. Zero-sum tracking. No missed logs.
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
        {/* Tabs */}
        <div className="grid grid-cols-2">
          <button
            onClick={() => setTab("create")}
            className={`py-3 text-sm font-medium transition-colors ${
              tab === "create"
                ? "bg-indigo-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            New Game
          </button>
          <button
            onClick={() => setTab("join")}
            className={`py-3 text-sm font-medium transition-colors ${
              tab === "join"
                ? "bg-indigo-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            Join Game
          </button>
        </div>

        <div className="p-6">
          {tab === "create" ? (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="game-name">Game Name</Label>
                <Input
                  id="game-name"
                  placeholder="Friday Night Poker"
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="chips-per-rupee">Chips per ₹1</Label>
                <Input
                  id="chips-per-rupee"
                  type="number"
                  placeholder="e.g. 10 (means ₹1 = 10 chips)"
                  value={chipsPerRupee}
                  onChange={(e) => setChipsPerRupee(e.target.value)}
                  min="0.01"
                  step="any"
                  required
                />
                <p className="text-xs text-zinc-500">
                  Used to convert chips to ₹ in the final summary
                </p>
              </div>

              {createError && (
                <p className="text-sm text-red-400">{createError}</p>
              )}

              <Button type="submit" className="w-full" disabled={creating}>
                <Plus className="w-4 h-4 mr-2" />
                {creating ? "Creating…" : "Create Game"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleJoin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="join-code">Game Code</Label>
                <Input
                  id="join-code"
                  placeholder="e.g. ROYAL-7X2"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  required
                  autoFocus
                  className="uppercase tracking-widest"
                />
              </div>

              {joinError && (
                <p className="text-sm text-red-400">{joinError}</p>
              )}

              <Button type="submit" className="w-full" disabled={joining}>
                <Search className="w-4 h-4 mr-2" />
                {joining ? "Finding…" : "Join Game"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>
          )}
        </div>
      </div>

      <p className="text-zinc-600 text-xs mt-8 text-center">
        Share the game code with other players — they can join on their phone browser.
      </p>
    </main>
  );
}
