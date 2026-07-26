import Link from "next/link";
import { Container, SectionHeader, PillLink } from "./ui";
import { Reveal } from "./reveal";

const POSTS = [
  {
    tag: "Takeoffs",
    date: "Feb 2, 2026",
    title: "The First Smart Takeoff Built for Fence Contractors",
    visual: (
      <div className="relative flex h-[180px] items-center justify-center overflow-hidden rounded-xl bg-accent-900">
        <div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:20px_20px]" />
        <svg viewBox="0 0 200 110" className="relative w-[190px]">
          <path
            d="M30 20 H120 V48 H170 V95 H30 Z"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M30 20 L52 42 L100 42 L120 20 M52 42 V72 L30 95 M52 72 L148 72 L170 48 M120 48 L148 72"
            stroke="rgba(255,255,255,0.55)"
            strokeWidth="1.3"
            strokeDasharray="4 4"
            fill="none"
          />
          <path d="M30 103 H170" stroke="#E8A13B" strokeWidth="2" />
          <path d="M30 99v8M170 99v8" stroke="#E8A13B" strokeWidth="2" />
        </svg>
        <span className="absolute bottom-3 left-4 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white/70">
          Sheet A-4 &middot; Site Plan
        </span>
      </div>
    ),
  },
  {
    tag: "Guide",
    date: "Jan 16, 2026",
    title: "How to Quote a Corner Lot Without Walking It",
    visual: (
      <div className="flex h-[180px] items-center justify-center rounded-xl bg-accent-950">
        <svg viewBox="0 0 160 90" className="w-[170px]">
          {/* corner lot: two street sides, fence on the other two */}
          <path d="M22 14 H138 V76 H54 L22 48 Z" fill="none" stroke="#ffffff" strokeWidth="2" />
          <rect x="66" y="26" width="40" height="26" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.4" />
          <path d="M22 14 H138 V76" fill="none" stroke="#3FA65B" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="96" cy="76" r="3.5" fill="#f472b6" stroke="#ffffff" strokeWidth="1.2" />
        </svg>
      </div>
    ),
  },
  {
    tag: "Satellite Measurement",
    date: "Jan 3, 2026",
    title: "Understanding Property Lines From the Sky",
    visual: (
      <div className="relative flex h-[180px] items-center justify-center overflow-hidden rounded-xl bg-[radial-gradient(90%_120%_at_50%_110%,#195F36,#0A2B19_70%)]">
        <div className="absolute inset-0 opacity-70 [background-image:radial-gradient(#E8A13B_1px,transparent_1.4px)] [background-size:22px_18px]" />
        <div className="relative h-16 w-24 rounded-md border-2 border-accent-300/80" />
      </div>
    ),
  },
];

export function Insights() {
  return (
    <section id="insights" className="bg-paper py-24 md:py-32">
      <Container>
        <Reveal>
          <SectionHeader
            eyebrow="Insights"
            title={
              <>
                Intelligence from the
                <br />
                takeoff frontier
              </>
            }
            copy="Research, field studies, and market intelligence on satellite measurement, remote estimating, and the economics of winning exterior work faster."
            action={<PillLink href="/sign-in" variant="outline">Explore Our Blog</PillLink>}
          />
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {POSTS.map((p, i) => (
            <Reveal key={p.title} delay={0.05 + i * 0.07}>
              <Link
                href="/sign-in"
                className="ring-focus group block h-full rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-card transition duration-300 will-change-transform hover:-translate-y-1 hover:border-zinc-300 hover:shadow-elevated motion-reduce:transform-none"
              >
                {p.visual}
                <div className="px-2 pb-2 pt-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                    {p.tag} &middot; {p.date}
                  </p>
                  <h3 className="mt-2 min-h-[52px] text-[16.5px] font-semibold leading-snug tracking-tight text-zinc-900">
                    {p.title}
                  </h3>
                  <p className="mt-4 text-[13px] font-medium text-accent-700">
                    Read Now{" "}
                    <span className="inline-block transition group-hover:translate-x-0.5 motion-reduce:transition-none">
                      &rarr;
                    </span>
                  </p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
