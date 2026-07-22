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
export const DRIVECHAINS: Drivechain[] = [
  {
    slot: 2,
    name: "BitNames",
    ticker: "BNMS",
    description: "A Namecoin/BitDNS variant aiming to replace ICANN",
    color: "#ef4444",
  },
  {
    slot: 4,
    name: "BitAssets",
    ticker: "BAST",
    description: "A sidechain for digital assets",
    color: "#3b82f6",
  },
  {
    slot: 9,
    name: "Thunder",
    ticker: "THDR",
    description: "Large & growing blocksize, plus fraud proofs",
    color: "#8b5cf6",
  },
  {
    slot: 13,
    name: "Truthcoin",
    ticker: "TRTH",
    description: "Decentralized prediction markets and oracle data",
    color: "#f59e0b",
  },
  {
    slot: 24,
    name: "Elements",
    ticker: "ELEM",
    description: "Blockstream Elements, enabling Simplicity script",
    color: "#22c55e",
  },
  {
    slot: 98,
    name: "zSide",
    ticker: "ZSDE",
    description: "Sidechain with private transactions",
    color: "#10b981",
  },
  {
    slot: 99,
    name: "Photon",
    ticker: "PHO",
    description: "Sidechain using post-quantum cryptography",
    color: "#06b6d4",
  },
  {
    slot: 255,
    name: "Coinshift",
    ticker: "CSHF",
    description: "P2P, trustless L2↔L1 swap system",
    color: "#ec4899",
  },
];
