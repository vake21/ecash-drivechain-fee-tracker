# eCash Meter

A dashboard that tracks how much each BIP 300/301 **drivechain** (sidechain) commits to
the **eCash** mainchain via blind-merged-mining (BMM) — both the per-chain BMM activity
and the fees fed to L1 miners.

> **eCash** here means a 2026 Bitcoin hard fork (a 1:1 BTC split with ~7 L2s),
> **not** the 2021 Bitcoin Cash spinoff (XEC).

## How it works

```
node (BitWindow)  →  npm run index  →  SQLite (.data/ecash-meter.sqlite)  →  Next.js site
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

## Rebuilding the store

The SQLite file is a **derived cache** — every value in it is re-computed from the node,
so it is safe to delete at any time. To rebuild from scratch:

```bash
rm .data/ecash-meter.sqlite && npm run index
```

The indexer stamps each database with the fee-attribution parser version it was written
with. If you upgrade to a build whose fee math changed, the indexer detects the mismatch
and **refuses to append to the old cache** (so stale fees can't silently linger) — it
prints the `rm … && npm run index` command above. Rebuilding takes well under a second.

## Fee attribution: current method and its limits

Fees are attributed by matching a coinbase BMM commitment (`h*`) to a non-coinbase
transaction whose `OP_RETURN` output **contains that 32-byte `h*`**, then charging
only that transaction's own fee to the committed slot (`lib/bmm.ts`).

This is a **heuristic**, not a full parse of a protocol-defined BMM-request format:

- **Guaranteed safe bounds (tested):** `h*` is always a complete 32-byte value, so a
  truncated/empty commitment can never match; each transaction's fee is attributed
  once and split across any slots it commits, so **the total attributed from a
  transaction never exceeds the fee it actually paid**.
- **Known limitation:** it matches *any* `OP_RETURN` that embeds the 32-byte
  sequence, which is broader than parsing an authoritative BMM-request tag + field
  layout. On the current orchestrator-driven signet this is moot (no fee-paying
  bids exist), but **before presenting this as mainnet-grade fee accounting**, the
  canonical BIP 301 BMM-request transaction format should be verified against
  drivechain/BitWindow protocol sources and parsed explicitly.
- If that verification changes how historical data is interpreted, bump
  `PARSER_VERSION` (`lib/bmm.ts`) and rebuild the derived cache (see above).

## Configuration

All settings live in `.env.local` (see `.env.example` for the full list). Key ones:

| Variable | Purpose |
|---|---|
| `ECASH_SOURCE` | `db` (stored history), `live` (scan per request), or `mock` |
| `ECASH_METER_DB` | Path to the SQLite file (default `./.data/ecash-meter.sqlite`) |
| `ECASH_RPC_URL` / `ECASH_RPC_USER` / `ECASH_RPC_PASS` | Mainchain JSON-RPC connection |
| `ECASH_SCAN_BLOCKS` | Blocks to backfill on the indexer's first run |

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · SQLite (`node:sqlite`).
