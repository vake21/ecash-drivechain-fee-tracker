import type { DashboardData, DrivechainStats, FeePoint } from "./types";
import { getMockDashboardData } from "./mock-data";
import { DRIVECHAINS } from "./config";
import { rpc, mapPool } from "./rpc";
import { parseBlock, utcDate, type RawBlock } from "./bmm";
import { getStoredDashboardData, EmptyStoreError } from "./store";
import { finalizeStats } from "./aggregate";

// Single entry point the UI calls for its data. All three sources return the same
// DashboardData shape, so none of the UI changes when we swap between them.
//
// Source is chosen by env (see .env.local):
//   ECASH_SOURCE=db    → read persisted history from Postgres (does NOT touch the
//                        node; the indexer keeps it fresh). Falls back to mock if
//                        the store is empty. This is the mode a deployed site uses.
//   ECASH_SOURCE=live  → scan the node directly at request time (short TTL cache).
//   ECASH_SOURCE=mock  → deterministic mock data.
// Back-compat: if ECASH_SOURCE is unset, ECASH_LIVE=1 means "live", else "mock".

const SOURCE = (
  process.env.ECASH_SOURCE ??
  (process.env.ECASH_LIVE === "1" ? "live" : "mock")
).toLowerCase();

// How many recent L1 blocks to scan per live snapshot (env-tunable). ~144/day.
const SCAN_BLOCKS = Number(process.env.ECASH_SCAN_BLOCKS ?? 432);
const CONCURRENCY = 24;
const CACHE_TTL_MS = 60_000;

let cache: { at: number; data: DashboardData } | null = null;

export async function getDashboardData(): Promise<DashboardData> {
  if (SOURCE === "mock") return getMockDashboardData();

  if (SOURCE === "db") {
    try {
      return await getStoredDashboardData();
    } catch (err) {
      if (err instanceof EmptyStoreError) {
        return {
          ...getMockDashboardData(),
          note: "No indexed history yet — run `npm run index`. Showing mock data.",
        };
      }
      console.error("[ecash-meter] store read failed, serving mock:", err);
      return {
        ...getMockDashboardData(),
        note: "History store unreachable — showing mock data.",
      };
    }
  }

  // SOURCE === "live": scan the node directly, behind a short TTL cache.
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  try {
    const data = await getLiveDashboardData();
    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.error("[ecash-meter] live scan failed, serving mock:", err);
    return {
      ...getMockDashboardData(),
      note: "Live node unreachable — showing mock data. Is BitWindow running?",
    };
  }
}

async function getLiveDashboardData(): Promise<DashboardData> {
  const chain = await rpc<{ chain: string }>("getblockchaininfo").then(
    (i) => i.chain,
  );
  const tip = await rpc<number>("getblockcount");
  const start = Math.max(0, tip - SCAN_BLOCKS + 1);
  const heights = Array.from({ length: tip - start + 1 }, (_, i) => start + i);

  const hashes = await mapPool(heights, CONCURRENCY, (h) =>
    rpc<string>("getblockhash", [h]),
  );
  const blocks = await mapPool(hashes, CONCURRENCY, (hash) =>
    rpc<RawBlock>("getblock", [hash, 3]), // verbosity 3 → per-tx fee + prevout values
  );

  // Per-slot, per-date tallies, built from the SHARED parser (lib/bmm.ts) so the
  // live path and the indexer can never interpret a block differently.
  const dates: string[] = [];
  const seenDates = new Set<string>();
  const tally = new Map<number, Map<string, { bmm: number; fee: number }>>();

  for (const raw of blocks) {
    const date = utcDate(raw.time);
    if (!seenDates.has(date)) {
      seenDates.add(date);
      dates.push(date);
    }
    for (const c of parseBlock(raw).commitments) {
      let byDate = tally.get(c.slot);
      if (!byDate) tally.set(c.slot, (byDate = new Map()));
      const cur = byDate.get(date) ?? { bmm: 0, fee: 0 };
      cur.bmm += 1;
      cur.fee += c.feeSats;
      byDate.set(date, cur);
    }
  }

  dates.sort();

  // Rolling 24h by block time (not "last active date"), consistent with the
  // stored path: fees on blocks newer than (latest block time − 24h), per slot.
  const lastBlockTime = blocks.reduce((m, b) => Math.max(m, b.time), 0);
  const cutoff = lastBlockTime - 86_400;
  const last24BySlot = new Map<number, number>();
  for (const raw of blocks) {
    if (raw.time <= cutoff) continue;
    for (const c of parseBlock(raw).commitments) {
      last24BySlot.set(c.slot, (last24BySlot.get(c.slot) ?? 0) + c.feeSats);
    }
  }

  const stats: DrivechainStats[] = DRIVECHAINS.map((chainMeta) => {
    const byDate = tally.get(chainMeta.slot);
    const series: FeePoint[] = dates.map((date) => ({
      date,
      bmmCount: byDate?.get(date)?.bmm ?? 0,
      feeSats: byDate?.get(date)?.fee ?? 0,
    }));
    const bmmCommitments = series.reduce((s, p) => s + p.bmmCount, 0);
    const totalFeesSats = series.reduce((s, p) => s + p.feeSats, 0);
    return {
      chain: chainMeta,
      totalFeesSats,
      feesLast24hSats: last24BySlot.get(chainMeta.slot) ?? 0,
      bmmCommitments,
      bmmBidCount: 0,
      avgBidSats: 0,
      shareOfTotal: 0, // filled by finalizeStats
      series,
    };
  });

  // Same metric-selection / share / ranking policy as the stored and mock paths.
  const { metric, grandTotalFeesSats, grandTotalBmmCommitments } =
    finalizeStats(stats);

  const network = (
    chain === "main" ? "mainnet" : chain === "test" ? "testnet" : "signet"
  ) as DashboardData["network"];

  return {
    network,
    metric,
    tipHeight: tip,
    windowDays: dates.length,
    blocksScanned: blocks.length,
    stats,
    grandTotalFeesSats,
    grandTotalBmmCommitments,
    lastBlockTime,
    note:
      grandTotalFeesSats === 0
        ? "BMM commitments are live; fee bids are ~0 on this orchestrator-driven signet."
        : undefined,
  };
}
