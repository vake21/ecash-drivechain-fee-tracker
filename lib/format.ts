import { L1_SYMBOL, SATS_PER_COIN } from "./config";

/** Format sats as coins with symbol, e.g. "12.3456 BTC". */
export function formatCoins(sats: number, decimals = 4): string {
  const coins = sats / SATS_PER_COIN;
  return `${coins.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${L1_SYMBOL}`;
}

/** Compact coins for tight spaces, e.g. "1.2K BTC". */
export function formatCoinsCompact(sats: number): string {
  const coins = sats / SATS_PER_COIN;
  return `${coins.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  })} ${L1_SYMBOL}`;
}

/** Whole-number sats with thousands separators, e.g. "1,234,567 sats". */
export function formatSats(sats: number): string {
  return `${sats.toLocaleString("en-US")} sats`;
}

/** Fraction (0-1) as a percentage, e.g. "23.4%". */
export function formatPct(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Integer with separators, e.g. "4,320". */
export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}
