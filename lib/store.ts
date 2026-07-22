// DB-backed dashboard reader. Aggregates persisted BMM commitments into the same
// DashboardData shape the mock and live-node paths return — so the UI is unchanged.
//
// This path NEVER talks to the node: the website reads history straight from
// Postgres, so it renders even while BitWindow is off. The indexer (scripts/index.ts)
// is what keeps the store fresh.

import type { DashboardData, DrivechainStats, FeePoint } from "./types";
import { DRIVECHAINS, WINDOW_DAYS } from "./config";
import { get, all, getMeta } from "./db";

/** Thrown when the store has no data yet (caller can fall back to mock). */
export class EmptyStoreError extends Error {}

interface AggRow {
  slot: number;
  date: string;
  bmm: number;
  fee: number;
}

export async function getStoredDashboardData(): Promise<DashboardData> {
  const tipRow = get<{ tip: number | null; scanned: number }>(
    "SELECT MAX(height) AS tip, COUNT(*) AS scanned FROM blocks",
  );
  const tipHeight = tipRow?.tip;
  const blocksScanned = tipRow?.scanned ?? 0;
  if (tipHeight == null || blocksScanned === 0) {
    throw new EmptyStoreError("no blocks indexed yet");
  }

  const rows = all<AggRow>(`
    SELECT c.slot AS slot,
           strftime('%Y-%m-%d', b.time, 'unixepoch') AS date,
           COUNT(*) AS bmm,
           COALESCE(SUM(c.fee_sats), 0) AS fee
    FROM commitments c
    JOIN blocks b ON b.height = c.height
    GROUP BY c.slot, date
  `);

  const network = (getMeta("network") ??
    "signet") as DashboardData["network"];

  // Most-recent WINDOW_DAYS distinct dates, chronological.
  const allDates = Array.from(new Set(rows.map((r) => r.date))).sort();
  const dates = allDates.slice(-WINDOW_DAYS);
  const dateSet = new Set(dates);
  const lastDate = dates[dates.length - 1];

  // slot -> date -> {bmm, fee}
  const tally = new Map<number, Map<string, { bmm: number; fee: number }>>();
  for (const r of rows) {
    if (!dateSet.has(r.date)) continue;
    let byDate = tally.get(r.slot);
    if (!byDate) tally.set(r.slot, (byDate = new Map()));
    byDate.set(r.date, { bmm: r.bmm, fee: r.fee });
  }

  const stats: DrivechainStats[] = DRIVECHAINS.map((chain) => {
    const byDate = tally.get(chain.slot);
    const series: FeePoint[] = dates.map((date) => ({
      date,
      bmmCount: byDate?.get(date)?.bmm ?? 0,
      feeSats: byDate?.get(date)?.fee ?? 0,
    }));
    const bmmCommitments = series.reduce((s, p) => s + p.bmmCount, 0);
    const totalFeesSats = series.reduce((s, p) => s + p.feeSats, 0);
    return {
      chain,
      totalFeesSats,
      feesLast24hSats: byDate?.get(lastDate)?.fee ?? 0,
      bmmCommitments,
      bmmBidCount: 0,
      avgBidSats: 0,
      shareOfTotal: 0, // filled below
      series,
    };
  });

  const grandTotalBmmCommitments = stats.reduce(
    (s, r) => s + r.bmmCommitments,
    0,
  );
  const grandTotalFeesSats = stats.reduce((s, r) => s + r.totalFeesSats, 0);
  for (const r of stats) {
    r.shareOfTotal =
      grandTotalBmmCommitments === 0
        ? 0
        : r.bmmCommitments / grandTotalBmmCommitments;
  }
  stats.sort((a, b) => b.bmmCommitments - a.bmmCommitments);

  return {
    network,
    metric: grandTotalFeesSats > 0 ? "fees" : "bmm",
    tipHeight,
    windowDays: dates.length,
    blocksScanned,
    stats,
    grandTotalFeesSats,
    grandTotalBmmCommitments,
    note:
      grandTotalFeesSats === 0
        ? "BMM commitments are live from stored history; fee bids are ~0 on this orchestrator-driven signet."
        : undefined,
  };
}
