// Fix #3 (stored path) — the store's SQL aggregation must rank and share by the
// selected metric. Reproduces the original bug end-to-end over an in-memory DB.

process.env.DCFT_DB = ":memory:";

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ensureSchema, run, setMeta, closeDb } from "../lib/db";
import { getStoredDashboardData } from "../lib/store";
import { utcDate } from "../lib/bmm";

const TIME = 1_752_000_000; // fixed recent timestamp → one date, within the window
const DAY = 86_400;

function hstar(n: number): string {
  return n.toString(16).padStart(64, "0");
}
function addDaysUTC(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000).toISOString().slice(0, 10);
}
/** Insert one block carrying one commitment for `slot` paying `fee` sats. */
function seedCommitment(height: number, slot: number, fee: number, time = TIME) {
  run("INSERT INTO blocks (height, hash, time) VALUES (?, ?, ?)", height, `h${height}`, time);
  run(
    "INSERT INTO commitments (height, slot, hstar, fee_sats) VALUES (?, ?, ?, ?)",
    height,
    slot,
    hstar(height),
    fee,
  );
}

beforeEach(() => {
  process.env.DCFT_DB = ":memory:";
  closeDb();
  ensureSchema();
  setMeta("network", "signet");
});
afterEach(() => closeDb());

test("fee mode ranks the quiet high-paying chain first (BitAssets over BitNames)", async () => {
  // BitNames (slot 2): 10 commitments, 10 sats total.
  for (let h = 1; h <= 10; h++) seedCommitment(h, 2, 1);
  // BitAssets (slot 4): 1 commitment, 1000 sats.
  seedCommitment(11, 4, 1000);

  const data = await getStoredDashboardData();
  assert.equal(data.metric, "fees");
  assert.equal(data.stats[0].chain.name, "BitAssets");
  assert.equal(data.stats[0].chain.slot, 4);
  // Share is by FEES: 1000 / 1010 ≈ 0.990.
  assert.ok(Math.abs(data.stats[0].shareOfTotal - 1000 / 1010) < 1e-6);
  const bitNames = data.stats.find((s) => s.chain.slot === 2)!;
  assert.ok(Math.abs(bitNames.shareOfTotal - 10 / 1010) < 1e-6);
});

test("no fees → bmm mode, ranked by commitment count", async () => {
  for (let h = 1; h <= 5; h++) seedCommitment(h, 2, 0); // BitNames: 5 commitments
  seedCommitment(6, 4, 0); // BitAssets: 1 commitment
  const data = await getStoredDashboardData();
  assert.equal(data.metric, "bmm");
  assert.equal(data.stats[0].chain.slot, 2); // 5 > 1
});

test("a zero-activity calendar day appears in the series with zero values", async () => {
  // Activity on day D-2 and day D, but NONE on D-1 → D-1 must be present as zero.
  seedCommitment(1, 2, 5, TIME - 2 * DAY);
  seedCommitment(2, 2, 7, TIME); // latest block → reference date = D
  const data = await getStoredDashboardData();
  assert.equal(data.windowDays, 3);
  const s2 = data.stats.find((s) => s.chain.slot === 2)!;
  assert.equal(s2.series.length, 3);
  assert.equal(s2.series[1].bmmCount, 0); // the skipped middle day D-1
  assert.equal(s2.series[1].feeSats, 0);
  assert.equal(s2.series[0].bmmCount, 1); // D-2 had a commitment
  assert.equal(s2.series[2].bmmCount, 1); // D had a commitment
});

test("window is exactly 30 dates and never reaches past 30 calendar days", async () => {
  seedCommitment(1, 2, 1, TIME - 40 * DAY); // sparse activity 40 days ago
  seedCommitment(2, 2, 1, TIME); // latest block
  const data = await getStoredDashboardData();
  assert.equal(data.windowDays, 30);
  for (const s of data.stats) assert.equal(s.series.length, 30);
  const refDate = utcDate(TIME);
  assert.equal(data.stats[0].series[0].date, addDaysUTC(refDate, -29)); // not -40
});

test("rolling 24h includes records inside the boundary and excludes older ones", async () => {
  seedCommitment(1, 2, 999, TIME - 90_000); // ~25h old → excluded
  seedCommitment(2, 2, 50, TIME - 1_000); // within 24h → included
  seedCommitment(3, 2, 100, TIME); // latest → included
  const data = await getStoredDashboardData();
  const s2 = data.stats.find((s) => s.chain.slot === 2)!;
  assert.equal(s2.feesLast24hSats, 150); // 50 + 100, not 999
});

test("lastBlockTime is exposed so the UI can flag stale data", async () => {
  seedCommitment(1, 2, 1, TIME - 5 * DAY);
  seedCommitment(2, 2, 1, TIME);
  const data = await getStoredDashboardData();
  assert.equal(data.lastBlockTime, TIME); // the most recent block time
});
