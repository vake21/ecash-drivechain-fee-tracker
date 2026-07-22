// Standalone block indexer. Runs where the node is reachable (your Mac), reads
// only NEW blocks since the last run, parses BMM commitments, and persists them.
// The website reads purely from the DB, so it never touches the node.
//
//   npm run index         # catch up to tip once
//
// Run it on a loop/cron for a periodically-fresh site. Idempotent: re-running is
// safe (ON CONFLICT DO NOTHING), and it resumes from the highest stored height.

import { rpc, mapPool } from "../lib/rpc";
import { parseBlock, type RawBlock } from "../lib/bmm";
import { ensureSchema, getDb, get, run, setMeta, tx } from "../lib/db";

// Load env (DCFT_DB, ECASH_RPC_*) before any connection is opened. Imports are
// hoisted, but the DB opens lazily and rpc reads env / matching defaults.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — rely on defaults / real env
}

const CONCURRENCY = 24;
// First-run backfill depth; later runs only fetch blocks newer than what's stored.
const BACKFILL = Number(
  process.env.ECASH_BACKFILL_BLOCKS ?? process.env.ECASH_SCAN_BLOCKS ?? 432,
);

async function main() {
  const startedAt = Date.now();
  await ensureSchema();

  const info = await rpc<{ chain: string }>("getblockchaininfo");
  const network =
    info.chain === "main"
      ? "mainnet"
      : info.chain === "test"
        ? "testnet"
        : "signet";
  const tip = await rpc<number>("getblockcount");

  const lastRow = get<{ max: number | null }>(
    "SELECT MAX(height) AS max FROM blocks",
  );
  const lastIndexed = lastRow?.max ?? null;

  const from =
    lastIndexed != null
      ? lastIndexed + 1
      : Math.max(0, tip - BACKFILL + 1);

  if (from > tip) {
    console.log(
      `[index] up to date — stored tip ${lastIndexed}, node tip ${tip}. Nothing to do.`,
    );
    getDb().close();
    return;
  }

  const heights = Array.from({ length: tip - from + 1 }, (_, i) => from + i);
  console.log(
    `[index] ${network}: fetching ${heights.length} block(s) ${from}..${tip} ` +
      `(stored tip: ${lastIndexed ?? "none"})`,
  );

  const hashes = await mapPool(heights, CONCURRENCY, (h) =>
    rpc<string>("getblockhash", [h]),
  );
  const blocks = await mapPool(hashes, CONCURRENCY, (hash) =>
    rpc<RawBlock>("getblock", [hash, 2]),
  );

  // Persist all blocks + commitments in one transaction so a crash never leaves
  // a block row without its commitments.
  let blockCount = 0;
  let commitmentCount = 0;
  tx(() => {
    for (const raw of blocks) {
      const parsed = parseBlock(raw);
      const ins = run(
        `INSERT INTO blocks (height, hash, time) VALUES (?, ?, ?)
         ON CONFLICT (height) DO NOTHING`,
        parsed.height,
        parsed.hash,
        parsed.time,
      );
      blockCount += Number(ins.changes);
      for (const c of parsed.commitments) {
        const cins = run(
          `INSERT INTO commitments (height, slot, hstar, fee_sats)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (height, slot, hstar) DO NOTHING`,
          parsed.height,
          c.slot,
          c.hstar,
          c.feeSats,
        );
        commitmentCount += Number(cins.changes);
      }
    }
    setMeta("network", network);
    setMeta("last_indexed_height", String(tip));
  });

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[index] done in ${secs}s — inserted ${blockCount} new block(s), ` +
      `${commitmentCount} new commitment(s). Stored tip now ${tip}.`,
  );
  getDb().close();
}

main().catch((err) => {
  console.error("[index] failed:", err);
  process.exitCode = 1;
});
