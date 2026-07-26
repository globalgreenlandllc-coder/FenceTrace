import { Container, PillLink } from "./ui";
import { Reveal } from "./reveal";

function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z" />
    </svg>
  );
}

export function CTA() {
  return (
    <section className="px-3 pb-3">
      <div className="relative overflow-hidden rounded-3xl bg-accent-950 py-24 md:py-32">
        <Sparkle className="anim-float absolute left-[8%] top-12 h-8 w-8 text-accent-500/60" />
        <Sparkle className="anim-float absolute bottom-14 right-[9%] h-10 w-10 text-accent-300/70 [animation-delay:0.8s]" />
        <Sparkle className="anim-float absolute bottom-24 left-[16%] h-4 w-4 text-accent-400/50 [animation-delay:1.6s]" />
        {/* light rain over the CTA */}
        <svg
          viewBox="0 0 600 120"
          className="pointer-events-none absolute inset-x-0 top-0 w-full opacity-60"
          preserveAspectRatio="none"
        >
          <g stroke="#5AA6C6" strokeWidth="2" strokeLinecap="round">
            {[60, 150, 260, 340, 430, 540].map((x, i) => (
              <line
                key={x}
                x1={x}
                y1="0"
                x2={x - 4}
                y2="14"
                className="anim-rain"
                style={{ animationDelay: `${i * 0.28}s` }}
              />
            ))}
          </g>
        </svg>
        <Container className="text-center">
          <Reveal>
            <h2 className="mx-auto max-w-2xl text-[32px] font-semibold leading-[1.05] tracking-tight text-white md:text-[46px]">
              Ready to activate your AI takeoffs?
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-white/60">
              Join contractors winning measured, three-tier bids &mdash; then
              running the signature, the schedule, and every payment in one
              place.
            </p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <PillLink href="/sign-in" variant="accent" className="ring-focus-dark">
                Get Started
              </PillLink>
              <PillLink
                href="/sign-in"
                variant="outline"
                className="ring-focus-dark border-white/20 bg-transparent text-white hover:border-white/40 hover:bg-white/5"
              >
                Contact Sales
              </PillLink>
            </div>
          </Reveal>
        </Container>
      </div>
    </section>
  );
}
