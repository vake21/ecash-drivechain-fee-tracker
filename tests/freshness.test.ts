// Fix #4 — data-freshness derivation used to flag stale data in the UI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFreshness, STALE_AFTER_SEC } from "../lib/freshness";

test("missing lastBlockTime → no label, not stale", () => {
  const f = computeFreshness(undefined, 1000);
  assert.deepEqual(f, { ageSec: null, isStale: false, label: null });
});

test("recent data is not stale and reads 'just now'", () => {
  const f = computeFreshness(1000, 1030); // 30s old
  assert.equal(f.isStale, false);
  assert.equal(f.label, "just now");
});

test("data older than the threshold is flagged stale", () => {
  const now = 1_000_000;
  const f = computeFreshness(now - STALE_AFTER_SEC - 1, now);
  assert.equal(f.isStale, true);
  assert.match(f.label!, /ago/);
});

test("age labels scale to minutes/hours/days", () => {
  assert.equal(computeFreshness(0, 600).label, "10m ago");
  assert.equal(computeFreshness(0, 7200).label, "2h ago");
  assert.equal(computeFreshness(0, 3 * 86_400).label, "3d ago");
});
