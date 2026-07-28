import Link from "next/link";
import { Container, SectionHeader } from "./ui";
import { Reveal } from "./reveal";

/** Small fence-style glyphs drawn per tier (decorative). */
function ChainLinkGlyph({ stroke }: { stroke: string }) {
  const d: string[] = [];
  for (let x = 28; x <= 118; x += 18) {
    d.push(`M${x} 18 L${x + 26} 70`);
    d.push(`M${x + 26} 18 L${x} 70`);
  }
  return (
    <svg viewBox="0 0 160 90" className="w-[132px]">
      <path d="M24 14 H136" stroke={stroke} strokeWidth="5" strokeLinecap="round" />
      <path d={d.join(" ")} fill="none" stroke={stroke} strokeWidth="2" opacity="0.55" />
      <path d="M24 74 H136" stroke={stroke} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function CedarGlyph({ stroke, cap }: { stroke: string; cap?: string }) {
  return (
    <svg viewBox="0 0 160 90" className="w-[132px]">
      {[34, 52, 70, 88, 106, 124].map((x) => (
        <rect key={x} x={x - 7} y={20} width={14} height={58} rx={2} fill="none" stroke={stroke} strokeWidth="3" />
      ))}
      <path d="M22 14 H138" stroke={cap ?? stroke} strokeWidth="5" strokeLinecap="round" />
      <path d="M24 40 H136 M24 62 H136" stroke={stroke} strokeWidth="2" opacity="0.45" />
    </svg>
  );
}

function OrnamentalGlyph() {
  return (
    <svg viewBox="0 0 160 90" className="w-[132px]">
      <defs>
        <linearGradient id="bronze" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#e0955e" />
          <stop offset="55%" stopColor="#c97a44" />
          <stop offset="100%" stopColor="#8a4f2d" />
        </linearGradient>
      </defs>
      {[40, 60, 80, 100, 120].map((x) => (
        <g key={x}>
          <path d={`M${x} 26 V78`} stroke="url(#bronze)" strokeWidth="4" strokeLinecap="round" />
          <path d={`M${x} 14 l-5 10 h10 Z`} fill="url(#bronze)" />
        </g>
      ))}
      <path d="M28 32 H132 M28 68 H132" stroke="url(#bronze)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

const TIERS = [
  {
    name: "good",
    visual: (
      <div className="relative flex h-[190px] items-center justify-center rounded-xl bg-accent-100 p-5">
        <span className="absolute right-4 top-4 font-mono text-[9px] font-bold uppercase tracking-wide text-accent-800/60">
          4&#8242; Chain-Link
        </span>
        <ChainLinkGlyph stroke="#0D1B12" />
        <p className="absolute bottom-4 left-5 text-[24px] font-semibold tracking-tight text-accent-900">
          Good
        </p>
      </div>
    ),
    title: "Dependable, priced to win",
    body: "Galvanized chain-link, posts set in concrete. The measured baseline bid that beats every flat quote on the street.",
  },
  {
    name: "better",
    visual: (
      <div className="relative flex h-[190px] items-center justify-center rounded-xl bg-[radial-gradient(120%_130%_at_20%_0%,#348D51,#114026_70%)] p-5">
        <span className="absolute right-4 top-4 font-mono text-[9px] font-bold uppercase tracking-wide text-white/60">
          6&#8242; Cedar Privacy
        </span>
        <CedarGlyph stroke="#ffffff" cap="#94C7A3" />
        <p className="absolute bottom-4 left-5 text-[24px] font-semibold tracking-tight text-white">
          Better<span className="text-accent-300">+</span>
        </p>
      </div>
    ),
    title: "The upgrade most homes choose",
    body: "Six-foot cedar privacy with a top cap and matching gates. More curb appeal, fewer callbacks.",
  },
  {
    name: "best",
    visual: (
      <div className="relative flex h-[190px] items-center justify-center rounded-xl bg-[radial-gradient(120%_130%_at_80%_0%,#8a4f2d,#0A2B19_75%)] p-5">
        <span className="absolute right-4 top-4 font-mono text-[9px] font-bold uppercase tracking-wide text-[#e0955e]/70">
          Ornamental Estate
        </span>
        <OrnamentalGlyph />
        <p className="absolute bottom-4 left-5 text-[24px] font-semibold tracking-tight text-[#e0955e]">
          Best
        </p>
      </div>
    ),
    title: "Premium materials & full finish",
    body: "Ornamental aluminum or premium vinyl, hardware upgraded on every gate. For the homeowner who asks for the top line.",
  },
];

export function Tiers() {
  return (
    <section id="proposals" className="bg-white py-24 md:py-32">
      <Container>
        <Reveal>
          <SectionHeader
            eyebrow="Premium Proposals"
            title={
              <>
                Curated tiers for
                <br />
                high-intent homeowners
              </>
            }
            copy="Three tiers, your materials, your margins. No race to the bottom."
          />
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {TIERS.map((t, i) => (
            <Reveal key={t.name} delay={(i + 1) * 0.05}>
              <div className="h-full rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-card hover-lift">
                {t.visual}
                <div className="px-2 pb-2 pt-5">
                  <h3 className="text-[16px] font-semibold tracking-tight text-zinc-900">
                    {t.title}
                  </h3>
                  <p className="mt-2 min-h-[60px] text-[13.5px] leading-relaxed text-zinc-500">
                    {t.body}
                  </p>
                  <div className="mt-4 flex items-center justify-between">
                    <Link
                      href="/sign-in"
                      className="ring-focus transition-smooth press-scale inline-flex h-9 items-center rounded-lg bg-accent-600 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-700"
                    >
                      View Sample
                    </Link>
                    <span className="text-[12px] text-zinc-400">
                      Why this tier?
                    </span>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
