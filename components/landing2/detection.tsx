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

/** Dark card: stylized shop-drawing cross-section (decorative). */
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
        {/* width dimension */}
        <text x="196" y="46" textAnchor="middle" fill="#93C6DC" fontSize="11" fontFamily="var(--font-mono), monospace" fontWeight="700">
          5 IN
        </text>
        <path d="M130 58 H172 M220 58 H262" stroke="#93C6DC" strokeWidth="1.5" />
        <path d="M130 52v12M262 52v12" stroke="#93C6DC" strokeWidth="1.5" />
        <text x="196" y="62" textAnchor="middle" fill="#93C6DC" fontSize="9" fontFamily="var(--font-mono), monospace">
          &#8596;
        </text>

        {/* height dimension */}
        <path d="M100 80 V225" stroke="#93C6DC" strokeWidth="1.5" />
        <path d="M94 80h12M94 225h12" stroke="#93C6DC" strokeWidth="1.5" />
        <text
          x="88"
          y="156"
          fill="#93C6DC"
          fontSize="11"
          fontFamily="var(--font-mono), monospace"
          fontWeight="700"
          transform="rotate(-90 88 156)"
          textAnchor="middle"
        >
          4 IN
        </text>

        {/* K-style profile: back wall, bottom, ogee face, curled lip */}
        <path
          d="M130 80 V225 H235 C260 225 268 200 252 185 C238 172 240 158 258 146 C276 134 280 112 262 100 L254 96"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="900"
          className="anim-trace"
        />
        {/* hanger */}
        <path d="M132 102 H256" stroke="rgba(255,255,255,0.25)" strokeWidth="2" strokeDasharray="5 5" />
        <circle cx="134" cy="102" r="3" fill="rgba(255,255,255,0.25)" />
        <circle cx="254" cy="102" r="3" fill="rgba(255,255,255,0.25)" />

        {/* water in the trough */}
        <path d="M142 212 H226" stroke="#0E9CC3" strokeWidth="11" strokeLinecap="round" opacity="0.3" />
        <path
          d="M142 212 H226"
          stroke="#0E9CC3"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="8 10"
          className="anim-flow"
        />

        {/* leader labels */}
        <path d="M262 100 L318 90" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <text x="322" y="93" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace">
          CAP
        </text>
        <path d="M252 180 L318 180" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <text x="322" y="183" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace">
          RAIL
        </text>
        <path d="M184 212 L184 252 L232 252" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <text x="236" y="255" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace">
          RUN 186 LF
        </text>

        {/* title block */}
        <text x="130" y="282" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-mono), monospace" fontWeight="700" letterSpacing="2">
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
