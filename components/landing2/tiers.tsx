import Link from "next/link";
import { Container, SectionHeader } from "./ui";
import { Reveal } from "./reveal";

/** Small abstract profile strokes drawn per tier (decorative). */
function KStyleGlyph({ stroke, guard }: { stroke: string; guard?: string }) {
  return (
    <svg viewBox="0 0 160 90" className="w-[132px]">
      <path
        d="M42 14 V70 H96 C112 70 117 55 107 46 C98 38 100 29 111 23 C122 17 123 8 112 4"
        fill="none"
        stroke={stroke}
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {guard ? (
        <path d="M40 10 L114 2" stroke={guard} strokeWidth="3" strokeDasharray="6 5" strokeLinecap="round" />
      ) : null}
    </svg>
  );
}

function HalfRoundGlyph() {
  return (
    <svg viewBox="0 0 160 90" className="w-[132px]">
      <defs>
        <linearGradient id="copper" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#e0955e" />
          <stop offset="55%" stopColor="#c97a44" />
          <stop offset="100%" stopColor="#8a4f2d" />
        </linearGradient>
      </defs>
      <path
        d="M34 22 C34 74 126 74 126 22"
        fill="none"
        stroke="url(#copper)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="34" cy="20" r="6" fill="none" stroke="url(#copper)" strokeWidth="4" />
      <circle cx="126" cy="20" r="6" fill="none" stroke="url(#copper)" strokeWidth="4" />
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
        <KStyleGlyph stroke="#0C1B24" />
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
      <div className="relative flex h-[190px] items-center justify-center rounded-xl bg-[radial-gradient(120%_130%_at_20%_0%,#2E86AD,#0E3A4D_70%)] p-5">
        <span className="absolute right-4 top-4 font-mono text-[9px] font-bold uppercase tracking-wide text-white/60">
          6&#8242; Cedar Privacy
        </span>
        <KStyleGlyph stroke="#ffffff" guard="#93C6DC" />
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
      <div className="relative flex h-[190px] items-center justify-center rounded-xl bg-[radial-gradient(120%_130%_at_80%_0%,#8a4f2d,#082733_75%)] p-5">
        <span className="absolute right-4 top-4 font-mono text-[9px] font-bold uppercase tracking-wide text-[#e0955e]/70">
          Ornamental Estate
        </span>
        <HalfRoundGlyph />
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
            copy="Measured properties command confident pricing. Every proposal ships with three tiers built from your own materials and margins — no guesswork, no race to the bottom."
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
