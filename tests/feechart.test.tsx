// Fix #3 — FeeChart must not crash when there are blocks but no commitments.
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FeeChart from "../components/FeeChart";
import type { DrivechainStats, FeePoint } from "../lib/types";

function statWith(slot: number, series: FeePoint[]): DrivechainStats {
  return {
    chain: { slot, name: `C${slot}`, ticker: "C", description: "", color: "#3b82f6" },
    totalFeesSats: 0,
    feesLast24hSats: 0,
    bmmCommitments: 0,
    bmmBidCount: 0,
    avgBidSats: 0,
    shareOfTotal: 0,
    series,
  };
}
const render = (stats: DrivechainStats[], windowDays: number) =>
  renderToStaticMarkup(
    React.createElement(FeeChart, { stats, windowDays, metric: "bmm" as const }),
  );

test("non-empty stats with empty series renders the empty state without throwing", () => {
  // 8 chains, all with empty series (blocks indexed, zero commitments).
  const stats = [2, 4, 9, 13, 24, 98, 99, 255].map((s) => statWith(s, []));
  let html = "";
  assert.doesNotThrow(() => {
    html = render(stats, 30);
  });
  assert.match(html, /No BMM commitments were found/);
  assert.doesNotMatch(html, /<svg/); // no chart geometry attempted
});

test("completely empty stats array also renders the empty state", () => {
  const html = render([], 30);
  assert.match(html, /No BMM commitments were found/);
});

test("a zero-filled window (dates present, all values 0) shows the empty state", () => {
  // The #4 store rework zero-fills the calendar window, so with no commitments
  // the series is non-empty but every value is 0 → still the empty state.
  const zeros: FeePoint[] = [
    { date: "2026-07-20", bmmCount: 0, feeSats: 0 },
    { date: "2026-07-21", bmmCount: 0, feeSats: 0 },
  ];
  const stats = [2, 4].map((s) => statWith(s, zeros));
  const html = render(stats, 2);
  assert.match(html, /No BMM commitments were found/);
  assert.doesNotMatch(html, /<svg/);
});

test("a populated series renders the chart (svg), not the empty state", () => {
  const series: FeePoint[] = [
    { date: "2026-07-20", bmmCount: 3, feeSats: 0 },
    { date: "2026-07-21", bmmCount: 5, feeSats: 0 },
    { date: "2026-07-22", bmmCount: 2, feeSats: 0 },
  ];
  const stats = [statWith(2, series), statWith(4, series)];
  const html = render(stats, 3);
  assert.match(html, /<svg/);
  assert.doesNotMatch(html, /No BMM commitments were found/);
});
