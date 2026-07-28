import Link from "next/link";
import { ArrowLeft, ArrowRight, Map, FileText } from "lucide-react";

export const metadata = {
  title: "Takeoff Demos — FenceScan",
  description:
    "Two interactive ways to measure fence linear footage: from satellite imagery or from an uploaded site plan.",
};

const METHODS = [
  {
    href: "/demo/satellite",
    tag: "Method A",
    icon: Map,
    title: "Property Scan Takeoff",
    blurb:
      "Type an address, pull high-resolution aerial imagery, and get an auto-traced outline. Drag runs to fine-tune, drop gates, and read live linear-footage and cost.",
    points: ["Address → aerial in one step", "Auto-traced runs & edges", "Ground-sample scale (no calibration)"],
  },
  {
    href: "/demo/blueprint",
    tag: "Method B",
    icon: FileText,
    title: "Plan Upload Takeoff",
    blurb:
      "Drop a site plan, calibrate the scale with a two-point measurement against a known dimension, then trace the fence line for exact, plan-accurate footage.",
    points: ["Upload a plan sheet", "2-point scale calibration", "Trace & measure to the inch"],
  },
];

export default function DemoIndexPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-ink text-white">
      <div
        aria-hidden
        className="hl-stripes absolute inset-y-0 right-0 hidden w-12 opacity-80 lg:block"
      />
      <div
        aria-hidden
        className="hl-stripes absolute inset-y-0 left-0 hidden w-3 opacity-50 lg:block"
      />
      <div className="relative mx-auto max-w-5xl px-6 py-16">
        <Link
          href="/"
          className="group ring-focus-dark inline-flex items-center gap-2 rounded-md text-sm text-white/60 transition-smooth hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" />{" "}
          Back home
        </Link>

        <header className="anim-enter mt-8">
          <p className="font-label inline-flex items-center rounded-md border border-white/25 px-2.5 py-1 text-white">
            Interactive Takeoff
          </p>
          <h1 className="display-hero mt-5 text-4xl sm:text-5xl">
            <span className="text-stripe-blue">Two ways</span>{" "}
            <span className="text-white">to measure a property.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-white/70">
            Both flows render the same drafting-style canvas — glowing blue
            runs, draggable vertices, live linear footage — over two different
            data sources. Pick one to try.
          </p>
        </header>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {METHODS.map((m, i) => {
            const Icon = m.icon;
            return (
              <Link
                key={m.href}
                href={m.href}
                className={`group anim-enter ${i === 0 ? "stagger-2" : "stagger-3"} hover-lift press-scale ring-focus-dark relative flex flex-col rounded-xl border border-white/10 bg-white/5 p-7 transition-smooth hover:border-stripe-blue/60 hover:bg-white/[0.08]`}
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-stripe-blue/15 text-stripe-blue ring-1 ring-stripe-blue/25">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-label text-[11px] text-white/40">
                    {m.tag}
                  </span>
                </div>
                <h2 className="mt-5 text-xl font-semibold tracking-tight text-white">
                  {m.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  {m.blurb}
                </p>
                <ul className="mt-5 space-y-2 text-sm text-white/80">
                  {m.points.map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-stripe-coral" />
                      {p}
                    </li>
                  ))}
                </ul>
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-stripe-blue">
                  Open demo
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
