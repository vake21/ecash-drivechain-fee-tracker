// Canonical-chain reconciliation + indexing core. Extracted from scripts/index.ts
// so it can be unit-tested against a mocked JSON-RPC boundary and an in-memory
// SQLite DB, with no live node.
//
// The DB is a derived cache and the indexer is its only writer. Blockchain history
// is NOT append-only: a reorganization can replace recent blocks. So before
// appending we (1) prove the DB belongs to the same chain (genesis hash), and
// (2) walk back to the most recent stored block that is still canonical, delete
// everything above it (cascading to its commitments), and re-index from there.
// All DB mutation for a run happens in ONE transaction, after blocks are fetched
// and validated, so a failure mid-run never leaves a torn cache.

import {
  parseBlock,
  PARSER_VERSION,
  type RawBlock,
} from "./bmm";
import { ensureSchema, get, run, tx, getMeta, setMeta } from "./db";

type Rpc = <T = unknown>(method: string, params?: unknown[]) => Promise<T>;
type MapPool = <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
) => Promise<R[]>;

export interface IndexerDeps {
  rpc: Rpc;
  mapPool: MapPool;
  log?: (msg: string) => void;
  /** First-run backfill depth (blocks). Defaults from env, else 432. */
  backfill?: number;
  concurrency?: number;
  /** How many times to restart reconciliation if the chain moves mid-download. */
  maxReorgRetries?: number;
}

export type RefusalReason =
  | "network-mismatch"
  | "unverifiable-history"
  | "parser-version"
  | "deep-reorg";

export interface IndexerResult {
  status: "ok" | "up-to-date" | "refused";
  reason?: RefusalReason;
  /** Operator-facing explanation, present when status is "refused". */
  message?: string;
  network?: string;
  fromHeight?: number;
  toHeight?: number;
  blocksInserted?: number;
  commitmentsInserted?: number;
  /** Blocks removed because they were no longer canonical (reorg depth). */
  reorgDepth?: number;
}

/** Thrown internally when the chain changes under us mid-download; triggers retry. */
class ReorgDetected extends Error {}

function mapChain(chain: string): "mainnet" | "testnet" | "signet" {
  return chain === "main"
    ? "mainnet"
    : chain === "test"
      ? "testnet"
      : "signet";
}

function localHashAt(height: number): string | null {
  const row = get<{ hash: string }>(
    "SELECT hash FROM blocks WHERE height = ?",
    height,
  );
  return row?.hash ?? null;
}

/**
 * Walk backward from min(localTip, nodeTip) to the most recent height whose stored
 * hash matches the node's canonical hash. Returns null if none within the stored
 * range agree (a reorg deeper than we can verify).
 */
async function findCommonAncestor(
  rpc: Rpc,
  localTip: number,
  nodeTip: number,
  minLocal: number,
): Promise<number | null> {
  let candidate = Math.min(localTip, nodeTip);
  while (candidate >= minLocal) {
    const stored = localHashAt(candidate);
    if (stored == null) {
      candidate--;
      continue;
    }
    const canonical = await rpc<string>("getblockhash", [candidate]);
    if (stored === canonical) return candidate;
    candidate--;
  }
  return null;
}

/**
 * Fetch blocks [from..nodeTip] at verbosity 3 and validate they form a canonical,
 * internally-consistent chain that connects to `ancestorHash` (null for a fresh
 * backfill's first block). Throws ReorgDetected if anything fails — the caller
 * discards the batch and re-reconciles.
 */
async function fetchAndValidate(
  rpc: Rpc,
  mapPool: MapPool,
  from: number,
  nodeTip: number,
  ancestorHash: string | null,
  concurrency: number,
): Promise<RawBlock[]> {
  if (from > nodeTip) return [];
  const heights = Array.from({ length: nodeTip - from + 1 }, (_, i) => from + i);
  const hashes = await mapPool(heights, concurrency, (h) =>
    rpc<string>("getblockhash", [h]),
  );
  const blocks = await mapPool(hashes, concurrency, (hash) =>
    rpc<RawBlock>("getblock", [hash, 3]),
  );

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b?.height !== heights[i] || b?.hash !== hashes[i]) {
      throw new ReorgDetected(`block ${heights[i]} did not match requested hash`);
    }
    const expectedPrev = i === 0 ? ancestorHash : blocks[i - 1].hash;
    if (expectedPrev != null && b.previousblockhash !== expectedPrev) {
      throw new ReorgDetected(`block ${b.height} does not connect to its parent`);
    }
  }

  // Re-check the tip is still canonical after the (possibly slow) download.
  if (blocks.length > 0) {
    const tipHashNow = await rpc<string>("getblockhash", [nodeTip]);
    if (tipHashNow !== hashes[hashes.length - 1]) {
      throw new ReorgDetected("node tip changed during download");
    }
  }
  return blocks;
}

export async function runIndexer(deps: IndexerDeps): Promise<IndexerResult> {
  const { rpc, mapPool } = deps;
  const log = deps.log ?? (() => {});
  const backfill =
    deps.backfill ??
    Number(
      process.env.ECASH_BACKFILL_BLOCKS ?? process.env.ECASH_SCAN_BLOCKS ?? 432,
    );
  const concurrency = deps.concurrency ?? 24;
  const maxRetries = deps.maxReorgRetries ?? 3;

  ensureSchema();

  const info = await rpc<{ chain: string }>("getblockchaininfo");
  const network = mapChain(info.chain);
  const genesis = await rpc<string>("getblockhash", [0]);

  const summary = get<{ max: number | null; min: number | null; cnt: number }>(
    "SELECT MAX(height) AS max, MIN(height) AS min, COUNT(*) AS cnt FROM blocks",
  )!;
  const hasData = summary.cnt > 0;
  const localTip = summary.max;
  const minLocal = summary.min;

  // ── Identity guard: is this DB even the same blockchain? ──
  const storedGenesis = getMeta("genesis_hash");
  if (hasData && storedGenesis != null && storedGenesis !== genesis) {
    return {
      status: "refused",
      reason: "network-mismatch",
      message:
        `[index] refusing to index: this database was built from a different chain ` +
        `(stored genesis ${storedGenesis.slice(0, 16)}…, node genesis ${genesis.slice(0, 16)}…).\n` +
        `        Databases from different networks must never be mixed. Point ECASH_METER_DB at a\n` +
        `        separate file for this network, or rebuild: delete the DB file and re-index.`,
    };
  }
  // ── Parser-version guard: stored fees computed by a different parser? ──
  const storedParser = getMeta("parser_version");
  if (hasData && storedParser !== String(PARSER_VERSION)) {
    return {
      status: "refused",
      reason: "parser-version",
      message:
        `[index] parser version mismatch — this DB was built with parser ` +
        `${storedParser ?? "(unversioned)"}, but the code is parser ${PARSER_VERSION}.\n` +
        `        The derived cache must be rebuilt: delete the DB file and re-index.`,
    };
  }
  // A non-empty DB with no recorded genesis can't be verified (predates identity
  // stamping). The current parser always stamps it, so this only trips on stale
  // caches — refuse rather than trust unverifiable history.
  if (hasData && storedGenesis == null) {
    return {
      status: "refused",
      reason: "unverifiable-history",
      message:
        `[index] this database has no recorded genesis hash, so its history cannot be\n` +
        `        verified against the node. Rebuild the derived cache: delete the DB file\n` +
        `        and re-index.`,
    };
  }

  // ── Reconcile + fetch, retrying if the chain moves under us mid-download. ──
  for (let attempt = 1; ; attempt++) {
    const nodeTip = await rpc<number>("getblockcount");

    let commonAncestor: number;
    let ancestorHash: string | null;
    if (!hasData) {
      // Fresh backfill: no stored history to reconcile against.
      commonAncestor = Math.max(0, nodeTip - backfill + 1) - 1;
      ancestorHash = null;
    } else {
      const found = await findCommonAncestor(rpc, localTip!, nodeTip, minLocal!);
      if (found === null) {
        return {
          status: "refused",
          reason: "deep-reorg",
          message:
            `[index] reorg deeper than stored history: no common ancestor within stored ` +
            `heights ${minLocal}..${localTip}.\n` +
            `        Cannot safely reconcile a partial cache this far back. Rebuild it: ` +
            `delete the DB file and re-index.`,
        };
      }
      commonAncestor = found;
      ancestorHash = localHashAt(commonAncestor);
    }

    const from = commonAncestor + 1;
    const reorgDepth = hasData ? Math.max(0, localTip! - commonAncestor) : 0;

    // Nothing new to add AND nothing stale to prune → genuinely up to date.
    if (from > nodeTip && reorgDepth === 0) {
      return { status: "up-to-date", network, toHeight: nodeTip };
    }

    let blocks: RawBlock[];
    try {
      blocks = await fetchAndValidate(
        rpc,
        mapPool,
        from,
        nodeTip,
        ancestorHash,
        concurrency,
      );
    } catch (err) {
      if (err instanceof ReorgDetected && attempt <= maxRetries) {
        log(
          `[index] chain moved during download (attempt ${attempt}) — re-reconciling…`,
        );
        continue;
      }
      throw err;
    }

    // Persist atomically: prune stale blocks, insert the validated batch, and
    // stamp identity/version — all in ONE transaction.
    let blocksInserted = 0;
    let commitmentsInserted = 0;
    tx(() => {
      if (hasData && reorgDepth > 0) {
        run("DELETE FROM blocks WHERE height > ?", commonAncestor); // cascades
      }
      for (const raw of blocks) {
        const parsed = parseBlock(raw);
        const ins = run(
          `INSERT INTO blocks (height, hash, time) VALUES (?, ?, ?)
           ON CONFLICT (height) DO NOTHING`,
          parsed.height,
          parsed.hash,
          parsed.time,
        );
        blocksInserted += Number(ins.changes);
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
          commitmentsInserted += Number(cins.changes);
        }
      }
      setMeta("network", network);
      setMeta("genesis_hash", genesis);
      setMeta("parser_version", String(PARSER_VERSION));
      setMeta("last_indexed_height", String(nodeTip));
    });

    return {
      status: "ok",
      network,
      fromHeight: from,
      toHeight: nodeTip,
      blocksInserted,
      commitmentsInserted,
      reorgDepth,
    };
  }
}
