-- Poker Accounting App - Supabase Schema
-- Run this in your Supabase SQL editor to set up the database.

-- ─── Tables ───────────────────────────────────────────────────────────────────

create table if not exists games (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,
  name             text not null,
  chips_per_rupee  numeric(10,2) not null default 1,
  status           text not null default 'active' check (status in ('active', 'ended')),
  created_at       timestamptz not null default now()
);

create table if not exists players (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  name       text not null,
  color      text not null default '#6366f1',
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  type       text not null check (type in ('buyin', 'cashout')),
  chips      numeric(12,0) not null check (chips > 0),
  note       text,
  created_at timestamptz not null default now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists idx_players_game_id       on players(game_id);
create index if not exists idx_transactions_game_id  on transactions(game_id);
create index if not exists idx_transactions_player_id on transactions(player_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- All rows are publicly readable/writable (game code is the access control).
-- You can tighten this later with auth if needed.

alter table games        enable row level security;
alter table players      enable row level security;
alter table transactions enable row level security;

create policy "Public read games"        on games        for select using (true);
create policy "Public insert games"      on games        for insert with check (true);
create policy "Public update games"      on games        for update using (true);

create policy "Public read players"      on players      for select using (true);
create policy "Public insert players"    on players      for insert with check (true);

create policy "Public read transactions" on transactions for select using (true);
create policy "Public insert transactions" on transactions for insert with check (true);

-- ─── Realtime ─────────────────────────────────────────────────────────────────
-- Enable realtime for live updates on the game board.

alter publication supabase_realtime add table players;
alter publication supabase_realtime add table transactions;
