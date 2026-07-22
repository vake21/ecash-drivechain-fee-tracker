// Core domain types for the drivechain fee tracker.
//
// The unit of account is satoshis of the L1 (mainchain) coin. eCash is a 1:1
// Bitcoin hard fork, so the mainchain coin uses 8-decimal (sat) precision.
//
// Under BIP 301 (blind merged mining), a sidechain's block is committed on L1
// by a "BMM bid" transaction whose fee is paid to the L1 miner. Summing those
// bids per sidechain slot tells us how much each drivechain feeds L1 security.

/** Static metadata for one drivechain (BIP 300 sidechain slot). */
export interface Drivechain {
  /** BIP 300 sidechain slot number (0-255). */
  slot: number;
  name: string;
  ticker: string;
  description: string;
  /** Tailwind-friendly accent color (hex) used in charts/cards. */
  color: string;
}

/**
 * A single BMM bid observed on the L1 mainchain. This is the raw unit we will
 * eventually parse from a full node; aggregates below are derived from these.
 */
export interface BmmBid {
  /** L1 block height the bid was confirmed in. */
  height: number;
  /** Sidechain slot this bid commits a block for. */
  slot: number;
  /** Fee paid to the L1 miner, in satoshis. */
  feeSats: number;
  /** L1 txid of the BMM bid transaction. */
  txid: string;
  /** Unix seconds of the L1 block. */
  time: number;
}

/** One day's worth of activity for one drivechain. */
export interface FeePoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  feeSats: number;
  /** BMM commitments that day (blocks the sidechain was merge-mined into). */
  bmmCount: number;
}

/** Rolled-up stats for one drivechain over the tracked window. */
export interface DrivechainStats {
  chain: Drivechain;
  /** Total fees fed to L1 over the whole window, in sats. */
  totalFeesSats: number;
  /** Fees in the most recent 24h, in sats. */
  feesLast24hSats: number;
  /**
   * BMM commitments over the window = blocks this sidechain was merge-mined
   * into (one coinbase h* commitment per block). This is the live, real signal
   * on the L2L signet even when fee bids are absent.
   */
  bmmCommitments: number;
  /** Number of fee-paying BMM bid txs identified (≈0 on orchestrator signets). */
  bmmBidCount: number;
  /** Average bid size, in sats (0 when no paid bids). */
  avgBidSats: number;
  /** Share of the headline metric (fees or BMM commitments) across chains (0-1). */
  shareOfTotal: number;
  /** Daily time series for charting. */
  series: FeePoint[];
}

/** Everything the dashboard needs, as returned by the data layer. */
export interface DashboardData {
  /** Network the data came from. */
  network: "mainnet" | "testnet" | "signet" | "mock";
  /**
   * Which metric is the meaningful headline for this dataset:
   *  - "fees": fees fed to L1 (mock, and any fee-active network)
   *  - "bmm":  BMM commitment activity (live signet, where fees are ~0)
   */
  metric: "fees" | "bmm";
  /** Latest L1 block height reflected in this snapshot. */
  tipHeight: number;
  /** Number of days covered by the series. */
  windowDays: number;
  /** Total blocks scanned to build this snapshot. */
  blocksScanned: number;
  stats: DrivechainStats[];
  /** Sum of totalFeesSats across all drivechains. */
  grandTotalFeesSats: number;
  /** Sum of bmmCommitments across all drivechains. */
  grandTotalBmmCommitments: number;
  /** Optional human note (e.g. why fees are ~0 on this network). */
  note?: string;
}
