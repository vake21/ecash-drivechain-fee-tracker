import { getDashboardData } from "@/lib/node";
import FeeChart from "@/components/FeeChart";
import {
  formatCoins,
  formatCoinsCompact,
  formatInt,
  formatPct,
} from "@/lib/format";

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
  } = data;
  const isBmm = metric === "bmm";
  const activeCount = stats.filter((r) => r.bmmCommitments > 0).length;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              eCash Drivechain Fee Tracker
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              {isBmm
                ? "Blind-merged-mining activity each BIP 301 drivechain commits to L1."
                : "Fees each BIP 301 drivechain feeds to L1 miners via blind-merged-mining bids."}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ring-1 ${
                network === "mock"
                  ? "bg-amber-500/15 text-amber-400 ring-amber-500/30"
                  : "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
              }`}
            >
              {network === "mock"
                ? "MOCK DATA"
                : `LIVE · ${network.toUpperCase()}`}
            </span>
            <span className="rounded-full bg-neutral-800 px-2.5 py-1 text-neutral-400">
              tip #{formatInt(tipHeight)}
            </span>
          </div>
        </header>

        {note ? (
          <div className="mb-6 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200/90">
            {note}
          </div>
        ) : null}

        {/* summary cards */}
        <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                value={formatCoins(grandTotalFeesSats, 2)}
              />
              <StatCard
                label="Fees last 24h"
                value={formatCoins(
                  stats.reduce((s, r) => s + r.feesLast24hSats, 0),
                  2,
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
        <section className="mb-8 rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
          <h2 className="mb-3 text-sm font-medium text-neutral-300">
            {isBmm ? "BMM activity over time" : "Fees fed to L1 over time"}
          </h2>
          <FeeChart stats={stats} windowDays={windowDays} metric={metric} />
        </section>

        {/* ranked table */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/50">
          <h2 className="px-5 pt-5 text-sm font-medium text-neutral-300">
            {isBmm
              ? "Drivechains by BMM activity"
              : "Drivechains by fees fed to L1"}
          </h2>
          <div className="overflow-x-auto p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
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
                    className="border-t border-neutral-800/70 hover:bg-neutral-800/30"
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
                      {r.totalFeesSats > 0
                        ? formatCoinsCompact(r.totalFeesSats)
                        : "—"}
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

        <footer className="mt-8 text-center text-xs text-neutral-600">
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-neutral-100">
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-neutral-500">{sub}</div> : null}
    </div>
  );
}
