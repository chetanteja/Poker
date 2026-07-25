-- PokerLedger v2 Migration
-- Run this in your Supabase SQL Editor.

-- 1. Add admin_token to games (identifies who created the game)
alter table games
  add column if not exists admin_token uuid not null default gen_random_uuid();

-- 2. Pending transactions — created by admin, approved/denied by the player
create table if not exists pending_transactions (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references games(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  type       text not null check (type in ('buyin', 'cashout')),
  chips      numeric(12,0) not null check (chips > 0),
  note       text,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now()
);

create index if not exists idx_pending_game_id   on pending_transactions(game_id);
create index if not exists idx_pending_player_id on pending_transactions(player_id);
create index if not exists idx_pending_status    on pending_transactions(status);

alter table pending_transactions enable row level security;

create policy "Public read pending"   on pending_transactions for select using (true);
create policy "Public insert pending" on pending_transactions for insert with check (true);
create policy "Public update pending" on pending_transactions for update using (true);

-- 3. Allow admins to delete transactions (undo)
create policy "Public delete transactions" on transactions for delete using (true);

-- 4. Enable realtime for pending_transactions
alter publication supabase_realtime add table pending_transactions;
