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
// a coinbase h*, then pricing the block's fee pool to that slot. ⚠ On this signet,
// blocks are orchestrator-driven (GenerateBlocks) with NO fee-paying bid txs — so
// fees read ~0 and the live headline metric is BMM commitment COUNT. The same
// parser yields real fee numbers on a fee-active network (mainnet).

/** The 4-byte BMM tag plus the OP_RETURN/push prefix, as a hex string. */
export const BMM_PREFIX = "6a25d1617368"; // 6a=OP_RETURN 25=push37 d1617368=tag

/** getblock verbosity-2 shapes we rely on. */
export interface RawTx {
  vout: { scriptPubKey: { hex: string }; value: number }[];
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

/** L1 block subsidy in sats at a given height (50 coin, halving every 210k). */
export function subsidySats(height: number): number {
  return Math.floor(50 * 1e8) >> Math.floor(height / 210_000);
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

  // Fee attribution: any non-coinbase tx whose OP_RETURN embeds a coinbase h*
  // is a paid BMM bid; price it from the block's fee pool. (Yields 0 on
  // orchestrator signets; correct on fee-active networks like mainnet.)
  if (commitments.length > 0) {
    const cbOut = Math.round(
      coinbase.vout.reduce((s, o) => s + o.value, 0) * 1e8,
    );
    const blockFee = Math.max(cbOut - subsidySats(b.height), 0);
    for (const tx of b.tx.slice(1)) {
      for (const v of tx.vout) {
        const hex = v.scriptPubKey.hex;
        if (!hex.startsWith("6a")) continue;
        const match = commitments.find((c) => hex.includes(c.hstar));
        if (match) match.feeSats += blockFee;
      }
    }
  }

  return { height: b.height, hash: b.hash, time: b.time, commitments };
}

/** UTC ISO date (YYYY-MM-DD) for a unix-seconds timestamp. */
export function utcDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
