import { Container, SectionHeader } from "./ui";
import { Reveal } from "./reveal";
import Link from "next/link";

function SpecTable() {
  const rows = [
    ["Imagery", "Aerial + Property lines"],
    ["Line confidence", "94%"],
    ["Style", "6′ Cedar Privacy"],
    ["Rate", "$28.50 / LF"],
  ];
  return (
    <div className="mt-8 divide-y divide-zinc-100 rounded-xl border border-zinc-200/70 bg-white shadow-card">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between px-4 py-3 text-[13px]">
          <span className="text-zinc-500">{k}</span>
          <span className="font-medium text-zinc-900">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Dark card: stylized fence-section shop drawing (decorative). */
function ProfileCard() {
  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl bg-accent-950 p-7">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
          Inside the geometry engine
        </p>
        <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wide text-white/40">
          Section A&ndash;A
        </span>
      </div>

      <svg viewBox="0 0 400 300" className="my-4 w-full">
        {/* post-spacing dimension */}
        <text x="196" y="46" textAnchor="middle" fill="#94C7A3" fontSize="11" fontFamily="var(--font-mono), monospace" fontWeight="700">
          8 FT
        </text>
        <path d="M137 58 H176 M216 58 H255" stroke="#94C7A3" strokeWidth="1.5" />
        <path d="M137 52v12M255 52v12" stroke="#94C7A3" strokeWidth="1.5" />

        {/* height dimension */}
        <path d="M100 80 V245" stroke="#94C7A3" strokeWidth="1.5" />
        <path d="M94 80h12M94 245h12" stroke="#94C7A3" strokeWidth="1.5" />
        <text
          x="88"
          y="162"
          fill="#94C7A3"
          fontSize="11"
          fontFamily="var(--font-mono), monospace"
          fontWeight="700"
          transform="rotate(-90 88 162)"
          textAnchor="middle"
        >
          6 FT
        </text>

        {/* pickets between the posts */}
        {Array.from({ length: 10 }, (_, i) => 152 + i * 10).map((x) => (
          <line key={x} x1={x} y1={88} x2={x} y2={242} stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
        ))}

        {/* 4×4 posts */}
        <rect x="130" y="76" width="14" height="174" fill="none" stroke="#ffffff" strokeWidth="2.5" />
        <rect x="248" y="76" width="14" height="174" fill="none" stroke="#ffffff" strokeWidth="2.5" />

        {/* rails */}
        <path d="M144 108 H248 M144 176 H248 M144 228 H248" stroke="#ffffff" strokeWidth="3" />

        {/* cap rail — animated trace along the top */}
        <path
          d="M124 80 H268"
          fill="none"
          stroke="#ffffff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="900"
          className="anim-trace"
        />
        {/* AI measuring line running the cap */}
        <path
          d="M124 68 H268"
          stroke="#3FA65B"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="8 10"
          className="anim-flow"
        />

        {/* concrete footings below grade */}
        <path d="M118 250 H400 M0 250 H106" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeDasharray="5 5" />
        <path d="M126 250 l4 26 h14 l4 -26 Z" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
        <path d="M244 250 l4 26 h14 l4 -26 Z" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />

        {/* leader labels */}
        <path d="M268 80 L318 74" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <text x="322" y="77" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace">
          CAP
        </text>
        <path d="M248 176 L318 168" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <text x="322" y="171" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace">
          RAIL
        </text>
        <path d="M197 242 L197 262 L232 262" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <text x="236" y="265" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace">
          RUN 186 LF
        </text>
        <path d="M148 276 L188 285" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <text x="192" y="288" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace">
          CONCRETE FTG
        </text>

        {/* title block */}
        <text x="130" y="298" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace" fontWeight="700" letterSpacing="2">
          CEDAR &middot; 4&times;4 POST &middot; STK GRADE
        </text>
      </svg>

      <div className="flex justify-end">
        <Link
          href="/sign-in"
          className="ring-focus-dark inline-flex h-10 items-center rounded-lg bg-accent-500 px-5 text-[13px] font-semibold text-white transition hover:bg-accent-400 active:scale-[0.98] motion-reduce:transform-none"
        >
          Explore the Engine
        </Link>
      </div>
    </div>
  );
}

export function Detection() {
  return (
    <section id="engine" className="bg-white py-24 md:py-32">
      <Container>
        <Reveal>
          <SectionHeader
            eyebrow="Measurement Intelligence"
            title={
              <>
                From detection to
                <br />
                signed proposal
              </>
            }
            copy="Our geometry engine pulls the property lines, splits the fence into runs, corners, and gate openings, and maps measured lengths to your own pricing — tiers, materials, and margins included."
          />
        </Reveal>

        <Reveal className="mt-14" delay={0.05}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-zinc-200/70 bg-paper p-7 md:p-9">
              <h3 className="text-[22px] font-semibold leading-tight tracking-tight text-zinc-900 md:text-[26px]">
                Detect. Measure. Price.
              </h3>
              <p className="mt-4 max-w-md text-[14px] leading-relaxed text-zinc-600">
                Real-time takeoff for any address or plan set &mdash;
                property-line tracing, run-by-run measurement, and line-item
                pricing in one flow.
              </p>
              <SpecTable />
            </div>
            <ProfileCard />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
