import { Container, Eyebrow, PillLink } from "./ui";
import { PlanTrace } from "./house-scene";
import { Reveal } from "./reveal";

const ROWS = [
  {
    title: "Fence lines traced from the sky",
    body: "An afternoon by wheel and tape. Instant here.",
    open: true,
  },
  { title: "Property lines pulled automatically", open: false },
  { title: "Proposals sent the same hour", open: false },
];

function TracePanel() {
  return (
    <div className="w-[240px] rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-[0_20px_45px_-20px_rgba(12,27,36,0.25)]">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-zinc-900">Fence Trace</p>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
          Complete
        </span>
      </div>
      <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
        {[
          ["Address", "1425 Maple Ave"],
          ["Fence line", "186 LF"],
          ["Gates", "3"],
          ["Confidence", "94%"],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-500">{k}</span>
            <span className="font-medium text-zinc-900">{v}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
        $5,301 estimate ready
      </div>
    </div>
  );
}


export function Engine() {
  return (
    <section id="takeoffs" className="bg-paper py-24 md:py-32">
      <Container>
        <Reveal>
          <div className="grid gap-14 md:grid-cols-2 md:gap-20">
            <div>
              <Eyebrow>Smart Takeoffs</Eyebrow>
              <h2 className="mt-6 text-[30px] font-semibold leading-[1.05] tracking-tight text-zinc-900 md:text-[40px]">
                FenceTrace measures the yards{" "}
                <span className="text-zinc-400">you never visit</span>
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-zinc-600">
                Every address hides a full takeoff &mdash; fence runs, corners,
                gate openings, property lines &mdash; that your current process
                only reveals with a truck roll. FenceTrace makes it visible.
              </p>
              <div className="mt-7">
                <PillLink href="/sign-in">Get Started</PillLink>
              </div>

              <div className="mt-12 divide-y divide-zinc-200 border-t border-zinc-200">
                {ROWS.map((r) => (
                  <div key={r.title} className="py-5">
                    <div className="flex items-center justify-between">
                      <p className="text-[15px] font-semibold tracking-tight text-zinc-900">
                        {r.title}
                      </p>
                      <span className="text-[18px] leading-none text-zinc-400">
                        {r.open ? "–" : "+"}
                      </span>
                    </div>
                    {r.body ? (
                      <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-zinc-500">
                        {r.body}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="relative flex items-center rounded-3xl bg-accent-50 p-6 md:p-10">
              <div className="w-full">
                <PlanTrace />
              </div>
              <div className="absolute bottom-8 right-6 md:right-10">
                <TracePanel />
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
