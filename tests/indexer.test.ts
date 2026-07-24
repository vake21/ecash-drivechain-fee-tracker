// Fix #1 — canonical-chain reconciliation: reorgs, network identity, mid-download
// races. Uses a scripted fake node (mocked JSON-RPC) and an in-memory SQLite DB.

process.env.DCFT_DB = ":memory:"; // must be set before db.ts opens a connection

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runIndexer } from "../lib/indexer";
import { mapPool } from "../lib/rpc";
import { closeDb, all, get, getMeta } from "../lib/db";
import { BMM_PREFIX, type RawTx } from "../lib/bmm";

interface FakeBlock {
  height: number;
  hash: string;
  previousblockhash?: string;
  time: number;
  tx: RawTx[];
}

/** A linear chain with deterministic hashes; supports extend / reorg / truncate. */
class FakeChain {
  chainName = "regtest";
  private arr: FakeBlock[] = [];
  constructor(len: number, tag = "base") {
    this.extend(len, tag);
  }
  get tip() {
    return this.arr.length - 1;
  }
  private mk(h: number, tag: string, prev?: string): FakeBlock {
    // One valid slot-2 BMM commitment per block → 1 commitment/block.
    const coinbase: RawTx = {
      vout: [{ scriptPubKey: { hex: BMM_PREFIX + "02" + "aa".repeat(32) }, value: 0 }],
    };
    return { height: h, hash: `${tag}:${h}`, previousblockhash: prev, time: 1_700_000_000 + h * 600, tx: [coinbase] };
  }
  extend(toLen: number, tag: string) {
    while (this.arr.length < toLen) {
      const h = this.arr.length;
      const prev = h === 0 ? undefined : this.arr[h - 1].hash;
      this.arr.push(this.mk(h, tag, prev));
    }
  }
  /** Keep heights [0, from), then rebuild up to newLen with a divergent tag. */
  reorg(from: number, newLen: number, tag: string) {
    this.arr = this.arr.slice(0, from);
    this.extend(newLen, tag);
  }
  truncate(newLen: number) {
    this.arr = this.arr.slice(0, newLen);
  }
  hashAt(h: number) {
    const b = this.arr[h];
    if (!b) throw new Error(`no block at height ${h}`);
    return b.hash;
  }
  byHash(hash: string) {
    const b = this.arr.find((x) => x.hash === hash);
    if (!b) throw new Error(`no block with hash ${hash}`);
    return b;
  }
  rpc = async <T = unknown>(method: string, params: unknown[] = []): Promise<T> => {
    switch (method) {
      case "getblockchaininfo":
        return { chain: this.chainName } as T;
      case "getblockcount":
        return this.tip as T;
      case "getblockhash":
        return this.hashAt(params[0] as number) as T;
      case "getblock":
        return this.byHash(params[0] as string) as T;
      default:
        throw new Error(`unexpected rpc ${method}`);
    }
  };
}

const run = (rpc: FakeChain["rpc"]) =>
  runIndexer({ rpc, mapPool, backfill: 100, concurrency: 4 });

function dbHeights(): number[] {
  return all<{ height: number }>("SELECT height FROM blocks ORDER BY height").map((r) => r.height);
}

beforeEach(() => {
  process.env.DCFT_DB = ":memory:";
  closeDb(); // fresh in-memory DB per test
});
afterEach(() => closeDb());

test("no reorg: only new blocks are fetched and inserted", async () => {
  const chain = new FakeChain(3); // heights 0..2
  await run(chain.rpc);
  assert.deepEqual(dbHeights(), [0, 1, 2]);

  chain.extend(5, "base"); // heights 0..4
  const res = await run(chain.rpc);
  assert.equal(res.status, "ok");
  assert.equal(res.blocksInserted, 2); // only 3,4
  assert.equal(res.reorgDepth, 0);
  assert.deepEqual(dbHeights(), [0, 1, 2, 3, 4]);
});

test("already caught up → 'up-to-date', nothing fetched", async () => {
  const chain = new FakeChain(4);
  await run(chain.rpc);
  const res = await run(chain.rpc);
  assert.equal(res.status, "up-to-date");
});

test("one-block reorg: stale tip and its commitments are replaced", async () => {
  const chain = new FakeChain(3); // 0..2 (base)
  await run(chain.rpc);
  chain.reorg(2, 4, "fork"); // height 2 replaced, 3 added
  const res = await run(chain.rpc);
  assert.equal(res.status, "ok");
  assert.equal(res.reorgDepth, 1);
  assert.deepEqual(dbHeights(), [0, 1, 2, 3]);
  assert.equal(get<{ hash: string }>("SELECT hash FROM blocks WHERE height=2")!.hash, "fork:2");
  // Orphaned block's commitment is gone; each of the 4 canonical blocks has one.
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM commitments")!.n, 4);
});

test("multi-block reorg: walks back to the common ancestor", async () => {
  const chain = new FakeChain(5); // 0..4 base
  await run(chain.rpc);
  chain.reorg(2, 6, "fork"); // 2,3,4 replaced + 5 added; ancestor = 1
  const res = await run(chain.rpc);
  assert.equal(res.status, "ok");
  assert.equal(res.reorgDepth, 3);
  assert.deepEqual(dbHeights(), [0, 1, 2, 3, 4, 5]);
  for (const h of [2, 3, 4, 5]) {
    assert.equal(get<{ hash: string }>("SELECT hash FROM blocks WHERE height=?", h)!.hash, `fork:${h}`);
  }
});

test("node tip lower than stored tip: prune, don't claim up-to-date", async () => {
  const chain = new FakeChain(5); // 0..4
  await run(chain.rpc);
  chain.truncate(3); // node tip now 2, no divergence below
  const res = await run(chain.rpc);
  assert.equal(res.status, "ok");
  assert.equal(res.reorgDepth, 2); // heights 3,4 removed
  assert.equal(res.blocksInserted, 0);
  assert.deepEqual(dbHeights(), [0, 1, 2]);
});

test("network mismatch: refuse and leave the database untouched", async () => {
  const chainA = new FakeChain(3, "base"); // genesis base:0
  await run(chainA.rpc);
  const before = dbHeights();
  const lastBefore = getMeta("last_indexed_height");

  const chainB = new FakeChain(4, "other"); // genesis other:0
  const res = await run(chainB.rpc);
  assert.equal(res.status, "refused");
  assert.equal(res.reason, "network-mismatch");
  assert.deepEqual(dbHeights(), before); // unchanged
  assert.equal(getMeta("last_indexed_height"), lastBefore);
});

test("deep reorg beyond stored history: refuse rather than trust it", async () => {
  const chain = new FakeChain(10); // 0..9
  await runIndexer({ rpc: chain.rpc, mapPool, backfill: 3, concurrency: 4 }); // stores 7,8,9
  assert.deepEqual(dbHeights(), [7, 8, 9]);
  chain.reorg(5, 11, "fork"); // diverges at height 5, below stored min (7)
  const res = await runIndexer({ rpc: chain.rpc, mapPool, backfill: 3, concurrency: 4 });
  assert.equal(res.status, "refused");
  assert.equal(res.reason, "deep-reorg");
  assert.deepEqual(dbHeights(), [7, 8, 9]); // untouched
});

test("reorg during download: inconsistent batch is not committed, retry succeeds", async () => {
  const chain = new FakeChain(3); // 0..2
  let corruptOnce = true;
  const flakyRpc = (async <T = unknown>(method: string, params: unknown[] = []): Promise<T> => {
    if (method === "getblock") {
      const b = chain.byHash(params[0] as string);
      if (corruptOnce && b.height === 1) {
        corruptOnce = false; // corrupt the batch only on the first attempt
        return { ...b, previousblockhash: "WRONG" } as T;
      }
      return b as T;
    }
    return chain.rpc<T>(method, params);
  }) as FakeChain["rpc"];

  const res = await run(flakyRpc);
  assert.equal(res.status, "ok");
  assert.deepEqual(dbHeights(), [0, 1, 2]);
  // The corrupt version was never persisted; the retry stored the real block.
  assert.equal(get<{ hash: string }>("SELECT hash FROM blocks WHERE height=1")!.hash, "base:1");
});
