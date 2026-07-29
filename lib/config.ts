import type { Drivechain } from "./types";

// The L1 mainchain coin symbol. eCash (a 2026 Bitcoin hard fork) is a
// 1:1 BTC split, so the mainchain coin uses BTC-style units (1 coin = 1e8 sats).
export const L1_SYMBOL = "BTC";
export const SATS_PER_COIN = 100_000_000;

// How many days of history the dashboard shows.
export const WINDOW_DAYS = 30;

// The active drivechain registry. Slots, names, and descriptions are the REAL
// values read from the L2L-Signet enforcer (ValidatorService.GetSidechains) on
// 2026-07-14. Update by re-querying that RPC when the slate changes; on the
// live network this list should be fetched from the node rather than hardcoded.
// Series colours are a validated categorical palette for a DARK surface, assigned
// to slots in fixed ascending order and never cycled or reassigned by rank — a
// chain keeps its colour no matter where it ranks. The chart stacks in this same
// order so the adjacent pairs on screen are the pairs that were validated.
// Checked with the palette validator (OKLab ΔE): worst adjacent CVD 8.4, worst
// adjacent normal-vision 19.3, all eight inside the dark lightness band and above
// 3:1 contrast. The previous hand-picked set failed three of those checks —
// zSide/Elements were ΔE 6.3 apart (indistinguishable to full colour vision) and
// Thunder/BitAssets ΔE 1.3 under deuteranopia. Re-run the validator before editing.
export const DRIVECHAINS: Drivechain[] = [
  {
    slot: 2,
    name: "BitNames",
    ticker: "BNMS",
    description: "A Namecoin/BitDNS variant aiming to replace ICANN",
    color: "#3987e5",
  },
  {
    slot: 4,
    name: "BitAssets",
    ticker: "BAST",
    description: "A sidechain for digital assets",
    color: "#d95926",
  },
  {
    slot: 9,
    name: "Thunder",
    ticker: "THDR",
    description: "Large & growing blocksize, plus fraud proofs",
    color: "#199e70",
  },
  {
    slot: 13,
    name: "Truthcoin",
    ticker: "TRTH",
    description: "Decentralized prediction markets and oracle data",
    color: "#c98500",
  },
  {
    slot: 24,
    name: "Elements",
    ticker: "ELEM",
    description: "Blockstream Elements, enabling Simplicity script",
    color: "#d55181",
  },
  {
    slot: 98,
    name: "zSide",
    ticker: "ZSDE",
    description: "Sidechain with private transactions",
    color: "#008300",
  },
  {
    slot: 99,
    name: "Photon",
    ticker: "PHO",
    description: "Sidechain using post-quantum cryptography",
    color: "#9085e9",
  },
  {
    slot: 255,
    name: "Coinshift",
    ticker: "CSHF",
    description: "P2P, trustless L2↔L1 swap system",
    color: "#e66767",
  },
];
