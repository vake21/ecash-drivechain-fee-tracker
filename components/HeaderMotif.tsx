// Ambient header artwork: an L1 block sequence with sidechain blocks branching
// off and committing back into the next mainchain block — the shape of merge
// mining. Purely decorative, so it is aria-hidden and never intercepts pointer
// events. Kept to the header band: a texture field behind the chart itself would
// compete with the value scale.
//
// Opacities were chosen by rendering the geometry over the real #0a0a0a page
// surface and comparing levels — teal below ~0.10 effective alpha disappears on
// near-black, and above ~0.25 it starts competing with the logo. The group sits
// at 0.30, putting the spine near 0.20 effective at the left and fading to 0.

const L1_BLOCKS = 11;
const STEP = 112;
const X0 = 24;
const L1_Y = 34;
const SIDE_Y = 80;
const L1_SIZE = 18;
const SIDE_SIZE = 11;
const VW = 1240;
const VH = 120;

export default function HeaderMotif() {
  const l1 = Array.from({ length: L1_BLOCKS }, (_, i) => X0 + i * STEP);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* Brand-tinted ambient glow, anchored behind the logo. */}
      <div
        className="absolute -left-24 -top-28 h-72 w-[36rem] rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(25,158,112,0.16), rgba(25,158,112,0))",
        }}
      />
      <div
        className="absolute -top-24 right-0 h-56 w-80 rounded-full blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(201,133,0,0.10), rgba(201,133,0,0))",
        }}
      />

      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMinYMid slice"
        fill="none"
      >
        <defs>
          {/* Fade the motif out to the right so it never crowds the status
              badges sitting on that side of the header. */}
          <linearGradient id="motif-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
            <stop offset="0.55" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="motif-mask">
            <rect x="0" y="0" width={VW} height={VH} fill="url(#motif-fade)" />
          </mask>
        </defs>

        <g
          mask="url(#motif-mask)"
          stroke="#199e70"
          strokeWidth="2"
          opacity="0.3"
        >
          {/* mainchain spine */}
          <line
            x1={X0}
            y1={L1_Y + L1_SIZE / 2}
            x2={VW - 40}
            y2={L1_Y + L1_SIZE / 2}
            strokeOpacity="0.75"
          />

          {l1.map((x, i) => {
            const next = l1[i + 1];
            const sx = x + STEP / 2 - SIDE_SIZE / 2;
            return (
              <g key={x}>
                {/* L1 block */}
                <rect
                  x={x}
                  y={L1_Y}
                  width={L1_SIZE}
                  height={L1_SIZE}
                  rx="3"
                  fill="#199e70"
                  fillOpacity="0.6"
                  stroke="none"
                />
                {next !== undefined && (
                  <>
                    {/* sidechain block, merge-mined between two L1 blocks */}
                    <rect
                      x={sx}
                      y={SIDE_Y}
                      width={SIDE_SIZE}
                      height={SIDE_SIZE}
                      rx="2"
                      fill="#199e70"
                      fillOpacity="0.4"
                      stroke="none"
                    />
                    {/* branch out of L1, then the commitment back into the next
                        mainchain block */}
                    <path
                      d={`M${x + L1_SIZE} ${L1_Y + L1_SIZE / 2} L${sx} ${SIDE_Y + SIDE_SIZE / 2}`}
                      strokeOpacity="0.45"
                    />
                    <path
                      d={`M${sx + SIDE_SIZE} ${SIDE_Y + SIDE_SIZE / 2} L${next} ${L1_Y + L1_SIZE / 2}`}
                      strokeOpacity="0.45"
                    />
                  </>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
