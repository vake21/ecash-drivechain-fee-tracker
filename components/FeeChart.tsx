import type { DrivechainStats, FeePoint } from "@/lib/types";
import { formatCoinsCompact, formatInt } from "@/lib/format";

interface Props {
  stats: DrivechainStats[];
  windowDays: number;
  /** Which series value to plot. "bmm" = commitment counts, "fees" = sats. */
  metric: "fees" | "bmm";
}

// Stacked bar chart: one bar per day, each segment one drivechain's contribution
// that day (BMM commitments or fees). Pure SVG — no chart dependency. SSR.
export default function FeeChart({ stats, windowDays, metric }: Props) {
  if (stats.length === 0) return null;

  const value = (p: FeePoint | undefined) =>
    metric === "bmm" ? (p?.bmmCount ?? 0) : (p?.feeSats ?? 0);
  const axisLabel = (v: number) =>
    metric === "bmm" ? formatInt(Math.round(v)) : formatCoinsCompact(v);

  const dates = stats[0].series.map((p) => p.date);

  // Daily total across all chains, for y-axis scaling.
  const dailyTotals = dates.map((_, i) =>
    stats.reduce((s, st) => s + value(st.series[i]), 0),
  );
  const maxDaily = Math.max(...dailyTotals, 1);

  // Chart geometry (viewBox units).
  const W = 720;
  const H = 260;
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = dates.length;
  const gap = 2;
  const barW = plotW / n - gap;

  // Gridlines at 25/50/75/100% of max.
  const gridYs = [0.25, 0.5, 0.75, 1].map((f) => ({
    f,
    y: padT + plotH * (1 - f),
  }));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Daily drivechain fees fed to L1"
      >
        {/* gridlines */}
        {gridYs.map((g) => (
          <g key={g.f}>
            <line
              x1={padL}
              x2={W - padR}
              y1={g.y}
              y2={g.y}
              stroke="#1f2937"
              strokeWidth={1}
            />
            <text
              x={W - padR}
              y={g.y - 3}
              textAnchor="end"
              className="fill-neutral-500"
              fontSize={9}
            >
              {axisLabel(maxDaily * g.f)}
            </text>
          </g>
        ))}

        {/* stacked bars */}
        {dates.map((date, i) => {
          const x = padL + i * (plotW / n) + gap / 2;
          let yCursor = padT + plotH;
          return (
            <g key={date}>
              {stats.map((st) => {
                const v = value(st.series[i]);
                const h = (v / maxDaily) * plotH;
                yCursor -= h;
                return (
                  <rect
                    key={st.chain.slot}
                    x={x}
                    y={yCursor}
                    width={barW}
                    height={h}
                    fill={st.chain.color}
                  >
                    <title>{`${st.chain.name} — ${date}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        {/* x-axis: first/mid/last date labels */}
        {[0, Math.floor(n / 2), n - 1].map((i) => {
          const x = padL + i * (plotW / n) + barW / 2;
          return (
            <text
              key={i}
              x={x}
              y={H - 8}
              textAnchor="middle"
              className="fill-neutral-500"
              fontSize={9}
            >
              {dates[i].slice(5)}
            </text>
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-neutral-500">
        {metric === "bmm"
          ? "Daily BMM commitments (blocks merge-mined), stacked by drivechain"
          : "Daily fees fed to L1 miners, stacked by drivechain"}{" "}
        · last {windowDays} {windowDays === 1 ? "day" : "days"}
      </p>
    </div>
  );
}
