import { Container, SectionHeader } from "./ui";
import { Reveal } from "./reveal";

function TruckIllo() {
  return (
    <div className="relative flex h-[170px] items-center justify-center overflow-hidden rounded-xl bg-[radial-gradient(100%_120%_at_20%_0%,#EFF7FA,#DFEEF5_55%,#BFDEEA)] px-6">
      <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wide text-zinc-500">
        22 mi &middot; 45 min
      </span>
      <svg viewBox="0 0 240 120" className="w-[230px]">
        {/* motion dashes */}
        <g stroke="#0C1B24" strokeWidth="2.5" strokeLinecap="round" opacity="0.35">
          <path d="M18 58h14M10 72h18M20 86h12" />
        </g>
        <g className="anim-float">
          {/* ladder on the rack */}
          <path d="M58 28 H150 M58 36 H150" stroke="#0C1B24" strokeWidth="2.5" strokeLinecap="round" />
          {[70, 86, 102, 118, 134].map((x) => (
            <path key={x} d={`M${x} 28 V36`} stroke="#0C1B24" strokeWidth="2" />
          ))}
          {/* cargo box + cab */}
          <rect x="52" y="42" width="96" height="50" rx="5" fill="#ffffff" stroke="#0C1B24" strokeWidth="2.5" />
          <path d="M148 92 V56 h22 l16 18 v18 Z" fill="#ffffff" stroke="#0C1B24" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M170 60 l11 13 h-11 Z" fill="#93C6DC" stroke="#0C1B24" strokeWidth="1.6" />
          <text x="100" y="73" textAnchor="middle" fill="#0C1B24" fontSize="11" fontWeight="600" fontFamily="var(--font-inter), sans-serif" letterSpacing="0.5">
            SITE VISIT
          </text>
        </g>
        {/* wheels + ground */}
        <circle cx="86" cy="96" r="10" fill="#ffffff" stroke="#0C1B24" strokeWidth="2.5" />
        <circle cx="164" cy="96" r="10" fill="#ffffff" stroke="#0C1B24" strokeWidth="2.5" />
        <path d="M14 108 H226" stroke="#0C1B24" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function GaugeIllo() {
  return (
    <div className="flex h-[170px] items-center justify-center rounded-xl bg-paper">
      <div className="relative flex h-[120px] w-[120px] items-center justify-center">
        <svg viewBox="0 0 120 120" className="absolute inset-0">
          {Array.from({ length: 36 }).map((_, i) => {
            const a = (i / 36) * Math.PI * 2;
            const x1 = 60 + Math.cos(a) * 48;
            const y1 = 60 + Math.sin(a) * 48;
            const x2 = 60 + Math.cos(a) * 56;
            const y2 = 60 + Math.sin(a) * 56;
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={i % 3 === 0 ? "#14688C" : "#E4E4E7"}
                strokeWidth="2"
                strokeLinecap="round"
              />
            );
          })}
        </svg>
        <div className="text-center">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            Without AI
          </p>
          <p className="text-[30px] font-semibold leading-none tracking-tight text-zinc-900">0%</p>
          <p className="text-[9px] text-zinc-400">measured remotely</p>
        </div>
      </div>
    </div>
  );
}

function QuoteIllo() {
  return (
    <div className="flex h-[170px] items-center justify-center rounded-xl bg-zinc-100">
      <div className="w-[180px] -rotate-3 rounded-lg bg-amber-300 p-4 shadow-[0_16px_30px_-14px_rgba(12,27,36,0.4)]">
        <p className="text-[13px] font-black lowercase tracking-tight text-[#0C1B24]">
          flat quote
        </p>
        <p className="mt-1 text-[10px] leading-snug text-[#0C1B24]/70">
          &ldquo;Fence: $4,500. Any yard, any lot.&rdquo;
        </p>
        <div className="mt-3 h-1.5 w-3/4 rounded-full bg-[#0C1B24]/15" />
        <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-[#0C1B24]/15" />
      </div>
    </div>
  );
}

const CARDS = [
  {
    illo: <TruckIllo />,
    title: "Built for truck rolls",
    body: "Manual estimating assumes exploration: a drive, a wheel, and an afternoon per quote. AI-scanned properties need a different model — measure first, visit only to install.",
  },
  {
    illo: <GaugeIllo />,
    title: "Blind until you arrive",
    body: "Without aerial measurement you know nothing about a yard until you're standing in it. No run lengths, no corner counts, no price — nothing a callback can capture.",
  },
  {
    illo: <QuoteIllo />,
    title: "Rigid quotes, fluid lots",
    body: "Flat per-yard pricing assumes every lot is average. Real properties have corners, slopes, and gates — brief windows of intent that demand measured, line-item bids.",
  },
];

export function Gap() {
  return (
    <section className="bg-white pb-24 pt-4 md:pb-32">
      <Container>
        <Reveal>
          <SectionHeader
            eyebrow="The Gap"
            title={
              <>
                Why manual measuring
                <br />
                loses the job
              </>
            }
            copy="Homeowners collecting quotes behave differently now. They arrive with intent, compare bids faster, and commit before slow estimators can react."
          />
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {CARDS.map((c, i) => (
            <Reveal key={c.title} delay={0.05 + i * 0.07}>
              <div className="h-full rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-card transition duration-300 will-change-transform hover:-translate-y-1 hover:shadow-elevated motion-reduce:transform-none">
                {c.illo}
                <div className="px-2 pb-3 pt-5">
                  <h3 className="text-[16px] font-semibold tracking-tight text-zinc-900">
                    {c.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-500">
                    {c.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
