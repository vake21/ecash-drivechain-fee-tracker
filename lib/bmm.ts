// Shared BMM (blind-merged-mining) parsing — the single source of truth used by
// BOTH the live node scan (lib/node.ts) and the persistent indexer (scripts/index.ts),
// so the two paths can never disagree on how a block is interpreted.
//
// ─── BMM ON-CHAIN FORMAT (verified against BitWindow L2L-Signet, 2026-07-14) ───
// Each mainchain coinbase carries one OP_RETURN output PER merge-mined slot:
//   script hex = 6a 25 d1617368 <slot:1 byte> <hStar:32 bytes>
//   (6a=OP_RETURN, 25=push 37 bytes, d1617368=BMM tag, then slot + h*)
// Counting these per slot gives real, live per-drivechain BMM activity.
//
// FEES: a drivechain pays L1 via the fee on the BMM *request* tx that commits
// that h*. We attribute a fee by finding a non-coinbase tx whose OP_RETURN embeds
// a coinbase h*, then charging ONLY that transaction's own fee to that slot — the
// individual bid's fee, never the block's aggregate fee pool. Each BMM request tx
// in a block is priced and attributed independently. ⚠ On this signet, blocks are
// orchestrator-driven (GenerateBlocks) with NO fee-paying bid txs — so fees read ~0
// and the live headline metric is BMM commitment COUNT. The same parser yields real
// per-bid fee numbers on a fee-active network (mainnet).
//
// Requires getblock verbosity 3 (Bitcoin Core ≥ v25): it supplies each tx's `fee`
// directly, plus `vin[].prevout.value` for the sum(inputs) − sum(outputs) fallback.

/** The 4-byte BMM tag plus the OP_RETURN/push prefix, as a hex string. */
export const BMM_PREFIX = "6a25d1617368"; // 6a=OP_RETURN 25=push37 d1617368=tag

/** getblock verbosity-3 shapes we rely on. */
export interface RawTx {
  vout: { scriptPubKey: { hex: string }; value: number }[];
  /** Per-tx fee in BTC (present for non-coinbase txs at verbosity 3). */
  fee?: number;
  /** Inputs; `prevout.value` (BTC) is present at verbosity 3. */
  vin?: { prevout?: { value: number } }[];
}
export interface RawBlock {
  height: number;
  hash: string;
  time: number;
  tx: RawTx[];
}

/** One BMM commitment parsed out of a block's coinbase. */
export interface ParsedCommitment {
  slot: number;
  /** 32-byte sidechain block hash commitment, hex. */
  hstar: string;
  /** Fee (sats) attributed to this commitment's slot (≈0 on orchestrator signets). */
  feeSats: number;
}
export interface ParsedBlock {
  height: number;
  hash: string;
  /** Unix seconds of the block. */
  time: number;
  commitments: ParsedCommitment[];
}

/** BTC (float) → whole sats, rounded (avoids f.p. drift, e.g. 3.031e-05 → 3031). */
function toSats(btc: number): number {
  return Math.round(btc * 1e8);
}

/**
 * Fee (sats) paid by a single transaction. Prefers the node-provided `fee`
 * (getblock verbosity 3); falls back to sum(inputs) − sum(outputs) from the
 * prevout values. Returns 0 if neither is available (never a block-wide proxy),
 * so missing data understates rather than overstates.
 */
export function txFeeSats(tx: RawTx): number {
  if (typeof tx.fee === "number") return toSats(tx.fee);
  if (tx.vin && tx.vin.length > 0 && tx.vin.every((i) => i.prevout)) {
    const inSats = tx.vin.reduce((s, i) => s + toSats(i.prevout!.value), 0);
    const outSats = tx.vout.reduce((s, o) => s + toSats(o.value), 0);
    return Math.max(inSats - outSats, 0);
  }
  return 0;
}

/**
 * Parse one block into its BMM commitments, with per-slot fee attribution.
 * Pure and deterministic: same block in → same result out.
 */
export function parseBlock(b: RawBlock): ParsedBlock {
  const coinbase = b.tx[0];
  const commitments: ParsedCommitment[] = [];

  for (const v of coinbase.vout) {
    const hex = v.scriptPubKey.hex;
    if (hex.startsWith(BMM_PREFIX)) {
      const slot = parseInt(hex.slice(12, 14), 16);
      const hstar = hex.slice(14, 14 + 64);
      commitments.push({ slot, hstar, feeSats: 0 });
    }
  }

  // Fee attribution: each non-coinbase tx whose OP_RETURN embeds a coinbase h* is a
  // paid BMM bid. Charge ONLY that tx's own fee to the slot(s) it commits — every
  // bid priced independently, never the block's aggregate fee pool. A single BMM
  // request normally commits exactly one slot; if one somehow commits several, its
  // fee is split evenly so the total attributed can never exceed the fee it paid.
  if (commitments.length > 0) {
    for (const tx of b.tx.slice(1)) {
      const matched = new Set<ParsedCommitment>();
      for (const v of tx.vout) {
        const hex = v.scriptPubKey.hex;
        if (!hex.startsWith("6a")) continue;
        for (const c of commitments) {
          if (hex.includes(c.hstar)) matched.add(c);
        }
      }
      if (matched.size === 0) continue;
      const share = Math.floor(txFeeSats(tx) / matched.size);
      for (const c of matched) c.feeSats += share;
    }
  }

  return { height: b.height, hash: b.hash, time: b.time, commitments };
}

/** UTC ISO date (YYYY-MM-DD) for a unix-seconds timestamp. */
export function utcDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
