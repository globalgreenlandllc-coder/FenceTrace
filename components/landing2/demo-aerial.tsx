/**
 * The demo property's aerial plate — a satellite tile drawn, not fetched.
 *
 * A real scan pulls a Google static-satellite tile; the landing
 * walkthrough can't (a key on every visitor, and a stranger's rooftop on
 * a marketing page). So the sample lot is rendered to the same 900×580
 * canvas at the same 3.6 px/ft: mottled lawn, asphalt street, concrete
 * drive, hipped roofs shaded by a north-east sun, mature canopies with
 * cast shadows, film grain and a vignette on top.
 *
 * Every value is derived from a seeded PRNG or a constant, never
 * Math.random — the server and client renders must be byte-identical.
 * Server component: it's static paint, and the overlay animation lives
 * in the client walkthrough that draws on top of it.
 */
import {
  DRIVEWAY,
  HOUSE,
  NEIGHBOURS,
  PATIO,
  TREES,
  WALKWAY,
  type Pt,
} from "./demo-property";

/** Sun sits in the north-east, so everything throws to the south-west —
 *  the same direction <Fence3D> casts, so the plan and the 3D agree. */
const SUN = { x: -0.58, y: 0.62 };

const poly = (pts: Pt[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
const shift = (pts: Pt[], d: number): Pt[] =>
  pts.map((p) => ({ x: p.x + SUN.x * d, y: p.y + SUN.y * d }));

/** mulberry32 — tiny, deterministic, good enough for lawn texture. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAWN_TONES = ["#3d4f2e", "#465838", "#4d6140", "#37472a", "#516844"];

/** Soft blotches of tone variation — what stops a flat green rectangle
 *  from reading as a flat green rectangle. */
function LawnMottle() {
  const r = rng(20250728);
  const blobs = Array.from({ length: 170 }, () => ({
    cx: r() * 940 - 20,
    cy: r() * 620 - 20,
    rx: 18 + r() * 54,
    ry: 14 + r() * 40,
    rot: r() * 180,
    fill: LAWN_TONES[Math.floor(r() * LAWN_TONES.length)],
    o: 0.12 + r() * 0.26,
  }));
  return (
    <g filter="url(#da-mottle)">
      {blobs.map((b, i) => (
        <ellipse
          key={i}
          cx={b.cx}
          cy={b.cy}
          rx={b.rx}
          ry={b.ry}
          fill={b.fill}
          opacity={b.o}
          transform={`rotate(${b.rot} ${b.cx} ${b.cy})`}
        />
      ))}
    </g>
  );
}

/** Mown stripes across the back lawn — the detail that makes people say
 *  "wait, is that a photo?". */
function MowStripes() {
  return (
    <g opacity="0.085">
      {Array.from({ length: 11 }, (_, i) => (
        <rect
          key={i}
          x={196}
          y={92 + i * 19}
          width={520}
          height={9.5}
          fill="#7d9862"
          transform={`rotate(-1.1 456 ${96 + i * 19})`}
        />
      ))}
    </g>
  );
}

function Canopy({ x, y, r, tone }: { x: number; y: number; r: number; tone: number }) {
  const tones = [
    ["#27381f", "#324a29", "#3d5931", "#47673a"],
    ["#2a3c1e", "#364d27", "#415c2f", "#4b6b37"],
    ["#243722", "#2f462b", "#395434", "#43613d"],
  ][tone % 3];
  const rr = rng(Math.round(x * 31 + y * 7 + r));
  const lobes = Array.from({ length: 9 }, () => {
    const a = rr() * Math.PI * 2;
    const d = rr() * r * 0.52;
    return {
      cx: x + Math.cos(a) * d,
      cy: y + Math.sin(a) * d,
      r: r * (0.36 + rr() * 0.3),
      fill: tones[Math.floor(rr() * 4)],
    };
  });
  return (
    <g>
      {/* cast shadow, thrown south-west like everything else */}
      <ellipse
        cx={x + SUN.x * r * 1.35}
        cy={y + SUN.y * r * 1.35}
        rx={r * 0.94}
        ry={r * 0.7}
        fill="rgba(14,26,14,0.5)"
        filter="url(#da-shadow)"
      />
      <circle cx={x} cy={y} r={r} fill={tones[0]} />
      {lobes.map((l, i) => (
        <circle key={i} cx={l.cx} cy={l.cy} r={l.r} fill={l.fill} opacity={0.92} />
      ))}
      {/* sun-side highlight */}
      <circle
        cx={x - SUN.x * r * 0.42}
        cy={y - SUN.y * r * 0.42}
        r={r * 0.34}
        fill="#5c7c43"
        opacity={0.42}
      />
    </g>
  );
}

/**
 * A hipped roof rendered as four shaded planes. `ridge` is the axis the
 * ridge board runs along; the planes facing the north-east sun come out
 * lighter, which is what makes the massing read from straight overhead.
 */
function HipRoof({
  x0,
  y0,
  x1,
  y1,
  ridge,
}: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ridge: "ew" | "ns";
}) {
  const LIT_N = "#6f6559";
  const LIT_E = "#655c51";
  const DARK_S = "#484038";
  const DARK_W = "#3d3730";
  const RIDGE = "#7c7264";

  if (ridge === "ew") {
    const inset = (y1 - y0) / 2;
    const my = (y0 + y1) / 2;
    const rx0 = x0 + inset;
    const rx1 = x1 - inset;
    return (
      <g>
        <polygon points={poly([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: rx1, y: my }, { x: rx0, y: my }])} fill={LIT_N} />
        <polygon points={poly([{ x: x1, y: y0 }, { x: x1, y: y1 }, { x: rx1, y: my }])} fill={LIT_E} />
        <polygon points={poly([{ x: x0, y: y1 }, { x: x1, y: y1 }, { x: rx1, y: my }, { x: rx0, y: my }])} fill={DARK_S} />
        <polygon points={poly([{ x: x0, y: y0 }, { x: rx0, y: my }, { x: x0, y: y1 }])} fill={DARK_W} />
        <line x1={rx0} y1={my} x2={rx1} y2={my} stroke={RIDGE} strokeWidth="2.4" />
        <g stroke="rgba(20,16,12,0.35)" strokeWidth="1.2">
          <line x1={x0} y1={y0} x2={rx0} y2={my} />
          <line x1={x1} y1={y0} x2={rx1} y2={my} />
          <line x1={x0} y1={y1} x2={rx0} y2={my} />
          <line x1={x1} y1={y1} x2={rx1} y2={my} />
        </g>
      </g>
    );
  }
  const inset = (x1 - x0) / 2;
  const mx = (x0 + x1) / 2;
  const ry0 = y0 + inset;
  const ry1 = y1 - inset;
  return (
    <g>
      <polygon points={poly([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: mx, y: ry0 }])} fill={LIT_N} />
      <polygon points={poly([{ x: x1, y: y0 }, { x: x1, y: y1 }, { x: mx, y: ry1 }, { x: mx, y: ry0 }])} fill={LIT_E} />
      <polygon points={poly([{ x: x0, y: y1 }, { x: x1, y: y1 }, { x: mx, y: ry1 }])} fill={DARK_S} />
      <polygon points={poly([{ x: x0, y: y0 }, { x: mx, y: ry0 }, { x: mx, y: ry1 }, { x: x0, y: y1 }])} fill={DARK_W} />
      <line x1={mx} y1={ry0} x2={mx} y2={ry1} stroke={RIDGE} strokeWidth="2.4" />
      <g stroke="rgba(20,16,12,0.35)" strokeWidth="1.2">
        <line x1={x0} y1={y0} x2={mx} y2={ry0} />
        <line x1={x1} y1={y0} x2={mx} y2={ry0} />
        <line x1={x0} y1={y1} x2={mx} y2={ry1} />
        <line x1={x1} y1={y1} x2={mx} y2={ry1} />
      </g>
    </g>
  );
}

export function DemoAerial() {
  const houseShadow = shift(HOUSE, 46);

  return (
    <g>
      <defs>
        <filter id="da-mottle" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="da-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <filter id="da-tight" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="da-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.6 0"
          />
        </filter>
        <radialGradient id="da-vignette" cx="50%" cy="46%" r="72%">
          <stop offset="55%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
      </defs>

      {/* ---------------- ground ---------------- */}
      <rect x={0} y={0} width={900} height={580} fill="#44573a" />
      {/* neighbouring lots read very slightly cooler than the subject lot */}
      <rect x={0} y={0} width={196} height={580} fill="#3f5136" />
      <rect x={710} y={0} width={190} height={580} fill="#415438" />
      <rect x={0} y={0} width={900} height={84} fill="#3e5135" />
      <LawnMottle />
      <MowStripes />

      {/* ---------------- street & walk ---------------- */}
      <rect x={0} y={534} width={900} height={46} fill="#494a4d" />
      <rect x={0} y={534} width={900} height={4} fill="#5c5d61" opacity="0.7" />
      <path d="M0 556 H900" stroke="#3d3e41" strokeWidth="1.6" strokeDasharray="42 26" opacity="0.7" />
      <rect x={0} y={516} width={900} height={15} fill="#8e8b83" />
      <g stroke="#75726b" strokeWidth="1.2">
        {Array.from({ length: 13 }, (_, i) => (
          <line key={i} x1={i * 72} y1={516} x2={i * 72} y2={531} />
        ))}
      </g>

      {/* ---------------- hardscape ---------------- */}
      <polygon points={poly(DRIVEWAY)} fill="#8b8880" />
      <polygon points={poly(DRIVEWAY)} fill="none" stroke="#78756e" strokeWidth="1.2" />
      <line x1={591} y1={446} x2={596} y2={580} stroke="#7a776f" strokeWidth="1.2" />
      <polygon points={poly(WALKWAY)} fill="#918e86" />
      <g stroke="#7c7972" strokeWidth="1">
        <line x1={431} y1={468} x2={461} y2={468} />
        <line x1={434} y1={492} x2={465} y2={492} />
      </g>
      <polygon points={poly(PATIO)} fill="#7f766a" />
      <g stroke="rgba(60,54,46,0.45)" strokeWidth="1">
        {Array.from({ length: 5 }, (_, i) => (
          <line key={i} x1={382 + (i + 1) * 23.6} y1={244} x2={382 + (i + 1) * 23.6} y2={291} />
        ))}
        <line x1={382} y1={267} x2={524} y2={267} />
      </g>

      {/* ---------------- neighbouring rooftops ---------------- */}
      {NEIGHBOURS.map((ring, i) => (
        <g key={i}>
          <polygon points={poly(shift(ring, 40))} fill="rgba(16,28,16,0.34)" filter="url(#da-tight)" />
          <polygon points={poly(ring)} fill={["#5e5549", "#665c4f", "#574e44"][i % 3]} />
          <polygon points={poly(ring)} fill="none" stroke="rgba(20,16,12,0.4)" strokeWidth="1.4" />
        </g>
      ))}

      {/* ---------------- the subject house ---------------- */}
      <polygon points={poly(houseShadow)} fill="rgba(14,26,14,0.5)" filter="url(#da-tight)" />
      <HipRoof x0={346} y0={292} x1={556} y1={448} ridge="ew" />
      <HipRoof x0={556} y0={366} x1={622} y1={448} ridge="ns" />
      <polygon points={poly(HOUSE)} fill="none" stroke="rgba(24,18,12,0.55)" strokeWidth="1.6" />
      {/* garage door + front stoop, just enough to orient the eye */}
      <rect x={562} y={442} width={54} height={7} rx={1.5} fill="#3f3833" />
      <rect x={426} y={442} width={34} height={7} rx={1.5} fill="#514840" />
      {/* foundation shrubs along the street elevation */}
      {[364, 386, 408, 476, 498, 520, 540].map((x) => (
        <circle key={x} cx={x} cy={455} r={9} fill="#3f5c31" opacity="0.92" />
      ))}

      {/* ---------------- canopies ---------------- */}
      {TREES.map((t, i) => (
        <Canopy key={i} {...t} />
      ))}

      {/* ---------------- photographic finish ---------------- */}
      <rect
        x={0}
        y={0}
        width={900}
        height={580}
        filter="url(#da-grain)"
        opacity="0.3"
        style={{ mixBlendMode: "overlay" }}
      />
      <rect x={0} y={0} width={900} height={580} fill="url(#da-vignette)" />
    </g>
  );
}
