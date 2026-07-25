// Helpers for persisting admin/player identity in localStorage.
// All calls are wrapped in try/catch to safely handle SSR environments.

export function saveAdminToken(code: string, token: string): void {
  try { localStorage.setItem(`poker_admin_${code}`, token); } catch { /* SSR */ }
}

export function getAdminToken(code: string): string | null {
  try { return localStorage.getItem(`poker_admin_${code}`); } catch { return null; }
}

export function savePlayerId(code: string, playerId: string): void {
  try { localStorage.setItem(`poker_player_${code}`, playerId); } catch { /* SSR */ }
}

export function getPlayerId(code: string): string | null {
  try { return localStorage.getItem(`poker_player_${code}`); } catch { return null; }
}
