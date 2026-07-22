# eCash Drivechain Fee Tracker

A dashboard that tracks how much each BIP 300/301 **drivechain** (sidechain) commits to
the **eCash** mainchain via blind-merged-mining (BMM) — both the per-chain BMM activity
and the fees fed to L1 miners.

> **eCash** here means Paul Sztorc's 2026 Bitcoin hard fork (a 1:1 BTC split with ~7 L2s),
> **not** the 2021 Bitcoin Cash spinoff (XEC).

## How it works

```
node (BitWindow)  →  npm run index  →  SQLite (.data/dcft.sqlite)  →  Next.js site
   L1 mainchain       block indexer        history store               reads the DB
```

- **Indexer** (`scripts/index.ts`) scans new L1 blocks, parses each coinbase's BMM
  commitments (one `OP_RETURN` per merge-mined slot), and stores them. It resumes from the
  highest block already stored, so re-running only fetches what's new.
- **Store** is a single SQLite file via Node's built-in `node:sqlite` — no database server.
- **Site** reads purely from the store, so it renders even when the node is offline.

On an orchestrator-driven signet, fee bids are ~0, so the live headline metric is **BMM
commitment count** per drivechain; the same parser yields real fee numbers on a fee-active
network.

## Getting started

Requires **Node ≥ 22** (uses the built-in `node:sqlite`) and, for live data, a running
[BitWindow](https://layertwolabs.com) node exposing mainchain JSON-RPC on `127.0.0.1:38332`.

```bash
npm install                 # install dependencies
cp .env.example .env.local  # create your local config (adjust if needed)
npm run index               # scan the node and populate the SQLite store
npm run dev                 # start the site at http://localhost:3000
```

Without a node, set `ECASH_SOURCE=mock` in `.env.local` to run against placeholder data.

## Keeping data fresh

The site is only as current as the last indexer run. Run the indexer on a loop or a cron
job to keep the store up to date:

```bash
npm run index   # safe to run repeatedly; only fetches new blocks
```

## Configuration

All settings live in `.env.local` (see `.env.example` for the full list). Key ones:

| Variable | Purpose |
|---|---|
| `ECASH_SOURCE` | `db` (stored history), `live` (scan per request), or `mock` |
| `DCFT_DB` | Path to the SQLite file (default `./.data/dcft.sqlite`) |
| `ECASH_RPC_URL` / `ECASH_RPC_USER` / `ECASH_RPC_PASS` | Mainchain JSON-RPC connection |
| `ECASH_SCAN_BLOCKS` | Blocks to backfill on the indexer's first run |

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · SQLite (`node:sqlite`).
