"use client";

import { useState } from "react";
import { Container, Eyebrow, PillLink } from "./ui";
import { TeaserScan } from "./teaser-scan";
import { HouseScene, type SceneTab } from "./house-scene";
import { Reveal } from "./reveal";

const TABS: SceneTab[] = ["Detection", "Measurement", "Pricing", "Proposal"];

/** Segmented pipeline control shown at the top of the hero showcase card. */
function PipelineTabs({
  active,
  onChange,
}: {
  active: SceneTab;
  onChange: (tab: SceneTab) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Takeoff pipeline stage"
      className="inline-flex max-w-full flex-wrap items-center justify-center gap-1 rounded-[22px] border border-white/60 bg-white/70 p-1 shadow-sm backdrop-blur sm:rounded-full"
    >
      {TABS.map((t) => {
        const isActive = t === active;
        return (
          <button
            key={t}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(t)}
            className={
              isActive
                ? "ring-focus flex items-center gap-1.5 rounded-full bg-accent-950 px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-white transition active:scale-[0.98] motion-reduce:transform-none"
                : "ring-focus rounded-full px-3.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide text-zinc-500 transition hover:text-zinc-800 active:scale-[0.98] motion-reduce:transform-none"
            }
          >
            {isActive && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            )}
            {t}
          </button>
        );
      })}
    </div>
  );
}

function Token({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "blue" | "orange" | "green";
}) {
  const tones = {
    blue: "bg-accent-50 text-accent-700",
    orange: "bg-amber-50 text-amber-700",
    green: "bg-emerald-50 text-emerald-700",
  } as const;
  return (
    <span className={`mx-0.5 rounded-md px-1.5 py-0.5 font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ShowcaseCard() {
  const [tab, setTab] = useState<SceneTab>("Detection");
  return (
    <div className="relative mt-14 overflow-hidden rounded-3xl bg-[radial-gradient(120%_140%_at_15%_0%,#EFF7FA_0%,#DFEEF5_35%,#BFDEEA_70%,#93C6DC_100%)] px-5 pb-14 pt-8 md:px-12 md:pb-16 md:pt-10">
      {/* soft glow blobs */}
      <div className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-white/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-accent-200/60 blur-3xl" />

      <div className="relative flex justify-center">
        <PipelineTabs active={tab} onChange={setTab} />
      </div>

      <div className="relative mt-8 grid items-center gap-8 md:grid-cols-[1.05fr_0.95fr] md:gap-12">
        <div className="flex justify-center">
          <HouseScene tab={tab} />
        </div>

        <div className="rounded-2xl border border-white/70 bg-white/90 p-6 shadow-[0_24px_60px_-24px_rgba(12,27,36,0.35)] backdrop-blur md:p-7">
          <p className="text-[14px] leading-[1.9] text-zinc-700 md:text-[15px]">
            A homeowner at <Token tone="blue">1425 Maple Ave</Token> requests a
            fence quote. FenceScan pulls the satellite view and property lines
            with <Token tone="green">94% confidence</Token>, measures the fence
            line at <Token tone="orange">186 LF</Token>, and prices it as{" "}
            <Token tone="blue">6&#8242; Cedar Privacy &middot; $28.50/LF</Token>.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-accent-950 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-white">
              Preview
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            {["Line Trace", "3 Gates", "4 Corners", "$5,301 Estimate"].map(
              (chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-500"
                >
                  {chip}
                </span>
              ),
            )}
          </div>
        </div>
      </div>

      <p className="absolute bottom-5 right-7 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent-900/60">
        Powered by Fencescan &#9632;
      </p>
    </div>
  );
}

export function Hero() {
  return (
    <section className="pb-10 pt-14 md:pt-20">
      <Container>
        <Reveal>
          <Eyebrow>Smart Takeoff Engine</Eyebrow>
          <div className="mt-6 grid gap-10 md:grid-cols-[1.4fr_0.6fr] md:items-start md:gap-12">
            <h1 className="text-[clamp(2.6rem,6vw,4.6rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-zinc-900">
              Where property lines
              <br />
              become fence quotes.
            </h1>
            <div className="max-w-sm md:justify-self-end md:pt-3">
              <p className="text-[15px] leading-relaxed text-zinc-600">
                Type the address. Draw the line. Send the proposal —
                60&nbsp;seconds, no tape measure.
              </p>
              <div className="mt-6 flex items-center gap-3">
                <PillLink href="/sign-up">Start free</PillLink>
                <PillLink href="/p/demo-7f3a2" variant="outline">
                  See a live proposal
                </PillLink>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal>
          <TeaserScan />
        </Reveal>

        <ShowcaseCard />
      </Container>
    </section>
  );
}
