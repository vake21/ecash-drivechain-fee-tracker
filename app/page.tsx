import Image from "next/image";
import { getDashboardData } from "@/lib/node";
import { computeFreshness } from "@/lib/freshness";
import FeeChart from "@/components/FeeChart";
import HeaderMotif from "@/components/HeaderMotif";
import { feeFormatter, formatCoins, formatInt, formatPct } from "@/lib/format";

// Data is read from the node at request time (behind a short TTL cache in the
// data layer), so don't prerender this route at build.
export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getDashboardData();
  const {
    stats,
    grandTotalFeesSats,
    grandTotalBmmCommitments,
    tipHeight,
    windowDays,
    blocksScanned,
    network,
    metric,
    note,
    lastBlockTime,
  } = data;
  const isBmm = metric === "bmm";
  const activeCount = stats.filter((r) => r.bmmCommitments > 0).length;

  // Fee amounts pick their unit per group, so satoshi-scale totals show as sats
  // rather than rounding away to "0.00 BTC". The two tiles key off the window
  // total so they always agree; the table column keys off its own largest row.
  const formatTileFee = feeFormatter(grandTotalFeesSats, (s) =>
    formatCoins(s, 2),
  );
  const formatRowFee = feeFormatter(
    Math.max(0, ...stats.map((r) => r.totalFeesSats)),
  );

  // Data freshness (computed in the data layer, not during render): flag stale so
  // an old indexer's data is never silently presented as current.
  const { isStale, label: freshness } = computeFreshness(lastBlockTime);

  // `isolate` on <main> is load-bearing: without a stacking context there, the
  // ambient layer (z-index -10) joins the ROOT stacking context and main's
  // opaque bg-neutral-950 paints straight over it, hiding the wallpaper.
  return (
    <main className="relative isolate min-h-screen bg-neutral-950 text-neutral-100">
      {/* Page-level ambient wash, fixed so it stays put while the page scrolls.
          Sits behind everything and never intercepts pointer events.

          Layers paint first-listed on top. The brand gradients sit ABOVE the
          scrim so they keep tinting the page, while the scrim dims only the
          wallpaper beneath it. The scrim is bottom-weighted because the artwork
          measures ~4% mean luminance across its top third but ~12% (p99 62%)
          across its bottom, which is exactly where the chart and table sit. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1100px 520px at 12% -8%, rgba(25,158,112,0.13), transparent 62%)," +
            "radial-gradient(900px 460px at 88% -4%, rgba(201,133,0,0.07), transparent 58%)," +
            "linear-gradient(to bottom, rgba(10,10,10,0.30), rgba(10,10,10,0.58) 45%, rgba(10,10,10,0.80))," +
            "url('/wallpaper.webp') center center / cover no-repeat",
        }}
      />
      <div className="mx-auto max-w-5xl px-6 py-12 sm:py-14">
        {/* header */}
        <header className="relative isolate mb-10 flex flex-wrap items-end justify-between gap-5 pb-4">
          <HeaderMotif />
          <div>
            {/* The wordmark is part of the logo, so the image carries the h1's
                accessible name rather than duplicating the text beside it. */}
            <h1>
              <Image
                src="/logo-dark.png"
                alt="eCash Meter"
                width={1581}
                height={357}
                priority
                className="h-12 w-auto sm:h-14"
              />
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-400">
              {isBmm
                ? "Blind-merged-mining activity each BIP 301 drivechain commits to L1."
                : "Fees each BIP 301 drivechain feeds to L1 miners via blind-merged-mining bids."}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium ring-1 ${
                network === "mock"
                  ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                  : "bg-brand/15 text-brand ring-brand/35"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  network === "mock" ? "bg-amber-400" : "bg-brand"
                }`}
              />
              {network === "mock"
                ? "MOCK DATA"
                : `LIVE · ${network.toUpperCase()}`}
            </span>
            <span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-neutral-400 ring-1 ring-white/10">
              tip #{formatInt(tipHeight)}
            </span>
            {freshness ? (
              <span
                className={`rounded-full px-3 py-1.5 font-medium ring-1 ${
                  isStale
                    ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                    : "bg-white/[0.06] text-neutral-400 ring-white/10"
                }`}
                title={`Latest indexed block time: ${new Date(
                  (lastBlockTime ?? 0) * 1000,
                ).toISOString()}`}
              >
                {isStale ? "stale · " : "updated "}
                {freshness}
              </span>
            ) : null}
          </div>
        </header>

        {note ? (
          <div className="mb-6 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200/90">
            {note}
          </div>
        ) : null}

        {/* summary cards */}
        <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {isBmm ? (
            <>
              <StatCard
                label={`BMM commitments (${windowDays}d)`}
                value={formatInt(grandTotalBmmCommitments)}
              />
              <StatCard
                label="Blocks scanned"
                value={formatInt(blocksScanned)}
              />
              <StatCard label="Active drivechains" value={String(activeCount)} />
              <StatCard
                label="Most active"
                value={stats[0]?.chain.name ?? "—"}
                sub={
                  stats[0]
                    ? formatPct(stats[0].shareOfTotal) + " of commitments"
                    : ""
                }
              />
            </>
          ) : (
            <>
              <StatCard
                label={`Total fees (${windowDays}d)`}
                value={formatTileFee(grandTotalFeesSats)}
              />
              <StatCard
                label="Fees last 24h"
                value={formatTileFee(
                  stats.reduce((s, r) => s + r.feesLast24hSats, 0),
                )}
              />
              <StatCard
                label="Active drivechains"
                value={String(stats.length)}
              />
              <StatCard
                label="Top contributor"
                value={stats[0]?.chain.name ?? "—"}
                sub={
                  stats[0] ? formatPct(stats[0].shareOfTotal) + " of fees" : ""
                }
              />
            </>
          )}
        </section>

        {/* chart */}
        <section className="panel mb-10 rounded-2xl p-6">
          <h2 className="mb-5 text-base font-semibold tracking-tight text-neutral-100">
            {isBmm ? "BMM activity over time" : "Fees fed to L1 over time"}
          </h2>
          <FeeChart stats={stats} windowDays={windowDays} metric={metric} />
        </section>

        {/* ranked table */}
        <section className="panel rounded-2xl">
          <h2 className="px-6 pb-1 pt-6 text-base font-semibold tracking-tight text-neutral-100">
            {isBmm
              ? "Drivechains by BMM activity"
              : "Drivechains by fees fed to L1"}
          </h2>
          <div className="overflow-x-auto px-3 pb-3 pt-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-neutral-500">
                  <th className="px-3 py-2 font-medium">Drivechain</th>
                  <th className="px-3 py-2 text-right font-medium">
                    BMM blocks
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Fees to L1
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((r) => (
                  <tr
                    key={r.chain.slot}
                    className="border-t border-white/[0.06] transition-colors hover:bg-white/[0.035]"
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: r.chain.color }}
                        />
                        <div>
                          <div className="font-medium text-neutral-100">
                            {r.chain.name}{" "}
                            <span className="text-neutral-500">
                              ({r.chain.ticker})
                            </span>
                          </div>
                          <div className="text-xs text-neutral-500">
                            slot {r.chain.slot} · {r.chain.description}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">
                      {formatInt(r.bmmCommitments)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-300">
                      {r.totalFeesSats > 0 ? formatRowFee(r.totalFeesSats) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="tabular-nums text-neutral-300">
                          {formatPct(r.shareOfTotal)}
                        </span>
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-800">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.max(r.shareOfTotal * 100, 2)}%`,
                              backgroundColor: r.chain.color,
                            }}
                          />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-10 text-center text-xs text-neutral-600">
          {network === "mock"
            ? "Mockup with placeholder data · numbers are illustrative until wired to a live eCash node."
            : `Live from ${network} · scanned ${formatInt(
                blocksScanned,
              )} blocks up to tip #${formatInt(tipHeight)}.`}
        </footer>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="panel panel-hover rounded-2xl p-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500">
        {label}
      </div>
      {/* Proportional figures, not tabular — equal-width digits read loose at
          display sizes. `tabular-nums` stays on the table, where numbers align
          vertically and need to. */}
      <div className="mt-2.5 text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl">
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-xs text-neutral-500">{sub}</div> : null}
    </div>
  );
}
