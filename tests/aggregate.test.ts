// Fix #3 — metric selection, share, and ranking all use the SAME metric.
import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeStats } from "../lib/aggregate";
import type { DrivechainStats, Drivechain } from "../lib/types";

function chain(slot: number, name: string): Drivechain {
  return { slot, name, ticker: name.slice(0, 4).toUpperCase(), description: "", color: "#000" };
}
function stat(slot: number, name: string, fees: number, bmm: number): DrivechainStats {
  return {
    chain: chain(slot, name),
    totalFeesSats: fees,
    feesLast24hSats: 0,
    bmmCommitments: bmm,
    bmmBidCount: 0,
    avgBidSats: 0,
    shareOfTotal: 0,
    series: [],
  };
}

test("no fees → metric 'bmm'; share and sort use commitment counts", () => {
  const stats = [stat(2, "A", 0, 3), stat(4, "B", 0, 7)];
  const { metric } = finalizeStats(stats);
  assert.equal(metric, "bmm");
  assert.equal(stats[0].chain.name, "B"); // 7 > 3
  assert.ok(Math.abs(stats[0].shareOfTotal - 7 / 10) < 1e-9);
});

test("nonzero fees → metric 'fees'; share and sort use fee sats", () => {
  const stats = [stat(2, "A", 10, 3), stat(4, "B", 90, 7)];
  const { metric } = finalizeStats(stats);
  assert.equal(metric, "fees");
  assert.equal(stats[0].chain.name, "B");
  assert.ok(Math.abs(stats[0].shareOfTotal - 90 / 100) < 1e-9);
});

test("a busy chain paying little ranks below a quiet chain paying more (fee mode)", () => {
  // The original bug: BitNames (10 commitments, 10 sats) beat BitAssets
  // (1 commitment, 1000 sats). Now BitAssets must win in fee mode.
  const stats = [stat(2, "BitNames", 10, 10), stat(4, "BitAssets", 1000, 1)];
  const { metric } = finalizeStats(stats);
  assert.equal(metric, "fees");
  assert.equal(stats[0].chain.name, "BitAssets");
  assert.ok(Math.abs(stats[0].shareOfTotal - 1000 / 1010) < 1e-9);
  assert.ok(Math.abs(stats[1].shareOfTotal - 10 / 1010) < 1e-9);
});

test("zero denominator yields 0 shares, never NaN/Infinity", () => {
  const stats = [stat(2, "A", 0, 0), stat(4, "B", 0, 0)];
  const { metric } = finalizeStats(stats);
  assert.equal(metric, "bmm");
  for (const s of stats) {
    assert.equal(s.shareOfTotal, 0);
    assert.ok(Number.isFinite(s.shareOfTotal));
  }
});

test("equal values use a deterministic tie-breaker (slot ascending)", () => {
  const stats = [stat(9, "C", 50, 5), stat(2, "A", 50, 5), stat(4, "B", 50, 5)];
  finalizeStats(stats);
  assert.deepEqual(stats.map((s) => s.chain.slot), [2, 4, 9]);
});

test("shares sum to ~1 when the selected grand total is nonzero", () => {
  const stats = [stat(2, "A", 33, 1), stat(4, "B", 33, 1), stat(9, "C", 34, 1)];
  finalizeStats(stats);
  const sum = stats.reduce((s, x) => s + x.shareOfTotal, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `shares summed to ${sum}`);
});

test("stored-path and live-path inputs produce identical output (same helper)", () => {
  const a = [stat(2, "A", 10, 3), stat(4, "B", 90, 7)];
  const b = [stat(2, "A", 10, 3), stat(4, "B", 90, 7)];
  const ra = finalizeStats(a);
  const rb = finalizeStats(b);
  assert.deepEqual(ra, rb);
  assert.deepEqual(a.map((s) => [s.chain.slot, s.shareOfTotal]), b.map((s) => [s.chain.slot, s.shareOfTotal]));
});
