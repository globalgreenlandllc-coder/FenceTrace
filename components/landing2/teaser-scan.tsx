"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, MapPin, ScanLine, Sparkles } from "lucide-react";
import { GutterDiagram } from "@/components/estimate/gutter-diagram";
import { ExampleScanPanel } from "@/components/landing2/example-scan";
import { EXAMPLE_SCAN } from "@/components/landing2/example-scan-data";
import type { Downspout, EditableLine, RoofStructure } from "@/lib/types";

/**
 * The landing page's acquisition hook: scan a real address BEFORE
 * signing up. Runs the actual satellite engine via /api/teaser (2/day
 * per IP) and renders the real trace — with the measurements locked
 * behind the free signup. Time-to-wow ≈ one form submit.
 *
 * The typed address is stashed in localStorage so the post-signup
 * dashboard can offer to finish exactly this scan.
 */

export const PENDING_SCAN_KEY = "fencetrace.pendingAddress";

type TeaserPayload = {
  eaves: EditableLine[];
  rakes: EditableLine[];
  downspouts: Pick<Downspout, "id" | "x" | "y">[];
  perimeter: { x: number; y: number }[];
  runCount: number;
  downspoutCount: number;
};

const SCAN_STEPS = [
  "Locating the property…",
  "Pulling the satellite view…",
  "Tracing the fence line…",
  "Marking gate openings…",
  "Squaring the corners…",
];

export function TeaserScan() {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [signupNudge, setSignupNudge] = useState(false);
  const [teaser, setTeaser] = useState<TeaserPayload | null>(null);
  const [step, setStep] = useState(0);
  // Pre-baked contractor-verified example (see example-scan-data.ts). Hidden
  // again the moment a real scan result lands — the visitor's own property wins.
  const [showExample, setShowExample] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, []);

  async function scan() {
    const addr = address.trim();
    if (addr.length < 8 || status === "loading") return;
    setStatus("loading");
    setError(null);
    setSignupNudge(false);
    setStep(0);
    stepTimer.current = setInterval(
      () => setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)),
      1400,
    );
    try {
      localStorage.setItem(PENDING_SCAN_KEY, addr);
    } catch {
      // private mode — the signup link still carries the address
    }
    try {
      const res = await fetch("/api/teaser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; teaser?: TeaserPayload; reason?: string; signup?: boolean }
        | null;
      if (!res.ok || !body?.ok || !body.teaser) {
        setSignupNudge(!!body?.signup);
        throw new Error(body?.reason || "Couldn't scan that address — please try again.");
      }
      setTeaser(body.teaser);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Couldn't scan that address.");
    } finally {
      if (stepTimer.current) {
        clearInterval(stepTimer.current);
        stepTimer.current = null;
      }
    }
  }

  const roofStructure: RoofStructure | undefined = teaser
    ? {
        perimeter: teaser.perimeter,
        ridges: [],
        valleys: [],
        confidence: 1,
      }
    : undefined;

  const signupHref = `/sign-up?utm_source=teaser${
    address.trim() ? `&address=${encodeURIComponent(address.trim())}` : ""
  }`;

  return (
    <div className="mt-10 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void scan();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label className="relative flex-1">
          <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={inputRef}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Type any US address — watch the fence line appear"
            autoComplete="street-address"
            className="ring-focus h-12 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-10 pr-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-accent-400 focus:bg-white"
          />
        </label>
        <button
          type="submit"
          disabled={status === "loading" || address.trim().length < 8}
          className="press-scale ring-focus inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent-600 px-5 text-[14px] font-semibold text-white transition-smooth hover:bg-accent-700 disabled:opacity-60"
        >
          {status === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ScanLine className="h-4 w-4" />
          )}
          {status === "loading" ? SCAN_STEPS[step] : "Scan my property — free"}
        </button>
      </form>

      {status === "error" && (
        <p className="mt-3 text-sm text-red-600">
          {error}
          {signupNudge && (
            <>
              {" "}
              <Link href={signupHref} className="font-semibold text-accent-700 underline">
                Create a free account →
              </Link>
            </>
          )}
        </p>
      )}

      {status === "ready" && teaser && (
        <div className="anim-enter-fade mt-4">
          <div className="aspect-[16/10] overflow-hidden rounded-2xl">
            <GutterDiagram
              eaves={teaser.eaves}
              downspouts={teaser.downspouts.map((d) => ({ ...d, heightFt: 10 }))}
              roofStructure={roofStructure}
              presentation
              redactNumbers
            />
          </div>
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-zinc-600">
              <span className="font-semibold text-zinc-900">
                {teaser.runCount} fence runs
              </span>{" "}
              and{" "}
              <span className="font-semibold text-zinc-900">
                {teaser.downspoutCount} gates
              </span>{" "}
              traced. Footage, materials and a send-ready proposal are one free
              account away.
            </p>
            <Link
              href={signupHref}
              className="press-scale ring-focus inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-zinc-900 px-5 text-[14px] font-semibold text-white transition-smooth hover:bg-zinc-800"
            >
              See my measurements
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}

      {/* Pre-baked example — a finished, contractor-verified scan the visitor
          can open without spending a teaser credit. A live result replaces it. */}
      {EXAMPLE_SCAN && status !== "ready" && !showExample && (
        <button
          type="button"
          onClick={() => setShowExample(true)}
          className="transition-smooth ring-focus group mt-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-accent-700 hover:text-accent-800"
        >
          <Sparkles className="h-3.5 w-3.5" />
          No address handy? See a finished example — {EXAMPLE_SCAN.address}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </button>
      )}
      {EXAMPLE_SCAN && status !== "ready" && showExample && (
        <ExampleScanPanel
          onScanYourOwn={() => inputRef.current?.focus()}
        />
      )}

      {status !== "ready" && (
        <p className="mt-3 text-xs text-zinc-400">
          Free · no card, no account needed for the preview · 2 scans a day
        </p>
      )}
    </div>
  );
}
