# PokerLedger

Real-time poker chip accounting — shareable game sessions, live ledger, and automatic imbalance detection.

## Setup

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the full contents of [`supabase/schema.sql`](supabase/schema.sql)
3. Go to **Project Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Environment

```bash
cp .env.local.example .env.local
# Edit .env.local with your Supabase credentials
```

### 3. Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Deploy to Vercel (optional)

```bash
npx vercel
# Add the two env vars in Vercel dashboard → Settings → Environment Variables
```

## How it works

- **Create a game** — enter a name and chips-per-₹ rate. You get a unique code like `ROYAL-7X2`.
- **Share the code** — anyone can join on their phone browser.
- **Log buyins & cashouts** — each transaction is timestamped and immutable.
- **Integrity banner** — always shows how many chips are unaccounted for (should be 0 at end).
- **End game** — chips are converted to ₹ and settle-up pairs are calculated with the minimum number of transfers.

## Accounting model

```
net_chips(player) = sum(cashouts) - sum(buyins)

integrity_gap = sum(all buyins) - sum(all cashouts)
              → 0 means fully balanced
              → N > 0 means N chips are missing a cashout log
```
