import { Container } from "./ui";
import { Reveal } from "./reveal";

/* Fictional trade-press / partner wordmarks, rendered as grayscale type. */
const MARKS = [
  <span key="1" className="text-[15px] font-black uppercase tracking-tight">
    The Fence Post
  </span>,
  <span key="2" className="text-[15px] font-black uppercase tracking-[0.12em]">
    Contractor Insider
  </span>,
  <span key="3" className="text-[17px] font-bold lowercase tracking-tight">
    lotline<span className="font-normal">/finance</span>
  </span>,
  <span key="4" className="text-[17px] font-semibold tracking-tight">
    Exteriors.com
  </span>,
  <span key="5" className="font-mono text-[15px] font-bold tracking-tight">
    Pacific_Builder
  </span>,
];

export function Logos() {
  return (
    <section className="border-y border-zinc-200/70 bg-paper py-8">
      <Container>
        <Reveal>
          <div className="flex flex-wrap items-center justify-center gap-x-14 gap-y-6 text-zinc-400 md:justify-between">
            {MARKS.map((m) => (
              <div
                key={m.key}
                className="transition-smooth opacity-80 grayscale hover:text-zinc-500 hover:opacity-100"
              >
                {m}
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
