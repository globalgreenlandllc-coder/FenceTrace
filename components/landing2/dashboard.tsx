import { Container, SectionHeader } from "./ui";
import { Reveal } from "./reveal";
import { AreaChart } from "./dashboard-chart";
import { CountUp } from "./stats";

/* Data-viz palette per the design spec: series-1..4 on an accent-950 panel. */
const TABS = [
  { label: "Aerial", dot: "#1E7340", active: true },
  { label: "Plan", dot: "#3FA65B", active: false },
  { label: "Manual", dot: "#E8A13B", active: false },
];

const KPIS = [
  { label: "Takeoffs (30d)", value: "540", delta: "+18%", dot: "#1E7340" },
  { label: "Fence feet measured", value: "109k", delta: "+24%", dot: "#3FA65B" },
  { label: "Avg turnaround", value: "4 min", delta: "-92%", dot: "#E8A13B" },
  { label: "Revenue quoted (30d)", value: "$96,330", delta: "+31%", dot: "#7C5CBF" },
];

export function Dashboard() {
  return (
    <section className="bg-paper py-24 md:py-32">
      <Container>
        <Reveal>
          <SectionHeader
            eyebrow="Live Takeoffs"
            title={
              <>
                See every yard as a
                <br />
                measured takeoff
              </>
            }
            copy="Takeoffs are a new category of estimate — measured, priced, and ready to send. Track every scan, source, and quoted dollar on one dashboard."
          />
        </Reveal>

        <Reveal className="mt-14" delay={0.05}>
          <div className="overflow-hidden rounded-3xl bg-accent-950 p-6 md:p-10">
            <div className="flex flex-wrap items-center gap-2">
              {TABS.map((t) => (
                <span
                  key={t.label}
                  className={
                    t.active
                      ? "flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-white"
                      : "flex items-center gap-2 rounded-full border border-white/10 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-white/40"
                  }
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: t.dot }}
                  />
                  {t.label}
                </span>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
              {KPIS.map((k) => (
                <div
                  key={k.label}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                      <span
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: k.dot }}
                      />
                      {k.label}
                    </p>
                    <span className="text-[11px] font-semibold text-emerald-300">
                      {k.delta}
                    </span>
                  </div>
                  <CountUp
                    value={k.value}
                    className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-white md:text-[30px]"
                  />
                </div>
              ))}
            </div>

            <AreaChart />
            <div className="mt-3 flex justify-between text-[10px] uppercase tracking-wider text-white/30">
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"].map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
