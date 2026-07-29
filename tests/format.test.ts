// Fee amounts are rendered in coin units, which silently rounds satoshi-scale
// totals to "0.00 BTC". `feeFormatter` picks the unit from the largest value in
// a set so small amounts survive display. Regression case: the L2L-Signet store
// held 378 sats total, which made every chart gridline read "0 BTC" beside
// full-height bars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SATS_PER_COIN } from "../lib/config";
import {
  feeFormatter,
  formatCoins,
  formatCoinsCompact,
  formatSats,
} from "../lib/format";

// 0.01 coins — below this, two-decimal coin display loses the amount.
const THRESHOLD = SATS_PER_COIN / 100;

test("satoshi-scale totals format as sats, not 0.00 coins", () => {
  const f = feeFormatter(378);
  assert.equal(f(378), "378 sats");
  assert.equal(f(189), "189 sats");
  // The bug this guards: coin display erases the amount entirely.
  assert.equal(formatCoinsCompact(378), "0 BTC");
});

test("totals at or above the threshold format as coins", () => {
  const f = feeFormatter(SATS_PER_COIN);
  assert.match(f(SATS_PER_COIN), /BTC$/);
  assert.doesNotMatch(f(SATS_PER_COIN), /sats$/);
});

test("threshold boundary: at the cutoff uses coins, just below uses sats", () => {
  assert.match(feeFormatter(THRESHOLD)(THRESHOLD), /BTC$/);
  assert.match(feeFormatter(THRESHOLD - 1)(THRESHOLD - 1), /sats$/);
});

test("the unit is chosen from the reference max, not the value formatted", () => {
  // A zero row inside a sats-scale set still reads in sats, so a column never
  // mixes units.
  assert.equal(feeFormatter(378)(0), "0 sats");
  // ...and a small row inside a coin-scale set stays in coins.
  assert.match(feeFormatter(SATS_PER_COIN)(1), /BTC$/);
});

test("an all-zero set formats as sats rather than 0.00 coins", () => {
  assert.equal(feeFormatter(0)(0), "0 sats");
});

test("caller can supply the coin formatter used above the threshold", () => {
  const f = feeFormatter(SATS_PER_COIN, (s) => formatCoins(s, 2));
  assert.equal(f(SATS_PER_COIN), "1.00 BTC");
});

test("fractional sats round to whole numbers", () => {
  // Chart gridlines are fractions of the max (maxDaily * 0.25), so the sats
  // formatter receives non-integers.
  assert.equal(formatSats(94.5), "95 sats");
  assert.equal(feeFormatter(378)(378 * 0.25), "95 sats");
});

test("sats output carries thousands separators", () => {
  assert.equal(formatSats(1_234_567), "1,234,567 sats");
});
