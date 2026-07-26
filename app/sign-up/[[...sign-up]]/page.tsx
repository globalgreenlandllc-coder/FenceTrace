import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { Logo } from "@/components/ui/logo";
import { getPlanPricing, packBlurb, usd } from "@/lib/plan-pricing";

// Pricing copy comes from the admin-editable config so this page can
// never promise a different number than checkout charges. Re-rendered
// every 5 min and immediately on /admin/pricing publish.
export const revalidate = 300;

const RAIN_DROPS: { x: number; y: number; d: string }[] = [
  { x: 40, y: 60, d: "0s" },
  { x: 120, y: 210, d: "0.35s" },
  { x: 200, y: 90, d: "0.7s" },
  { x: 270, y: 320, d: "0.15s" },
  { x: 340, y: 150, d: "0.55s" },
  { x: 410, y: 40, d: "0.9s" },
  { x: 480, y: 260, d: "0.25s" },
  { x: 550, y: 120, d: "0.65s" },
  { x: 80, y: 430, d: "0.45s" },
  { x: 160, y: 560, d: "0.1s" },
  { x: 240, y: 480, d: "0.8s" },
  { x: 320, y: 620, d: "0.3s" },
  { x: 400, y: 520, d: "0.6s" },
  { x: 470, y: 680, d: "0.05s" },
  { x: 540, y: 440, d: "0.75s" },
  { x: 60, y: 700, d: "0.5s" },
  { x: 300, y: 740, d: "0.95s" },
  { x: 520, y: 580, d: "0.4s" },
];

export default async function SignUpPage() {
  const pricing = await getPlanPricing();
  const included = pricing.pro.includedCredits;
  const freeBlueprints = pricing.free.blueprintCredits;
  // Cheapest per-takeoff top-up rate, for the "per extra" stat.
  const cheapestPack = pricing.packs.length
    ? pricing.packs.reduce((a, b) =>
        a.amountCents / a.credits <= b.amountCents / b.credits ? a : b,
      )
    : null;
  return (
    <div className="relative grid min-h-screen bg-white lg:grid-cols-2">
      <div className="relative flex flex-col justify-between p-8 sm:p-12">
        <Link href="/" className="ring-focus rounded-md self-start">
          <Logo />
        </Link>

        <div className="anim-enter mx-auto flex w-full max-w-sm flex-col">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Create your account
          </h1>
          <p className="mt-2 mb-6 text-zinc-600">
            Start free — unlimited address estimates
            {freeBlueprints > 0
              ? ` plus ${freeBlueprints} plan takeoff${freeBlueprints === 1 ? "" : "s"}`
              : ""}
            . No card required.
          </p>

          <SignUp
            routing="path"
            path="/sign-up"
            signInUrl="/sign-in"
            fallbackRedirectUrl="/dashboard"
            appearance={{
              elements: {
                rootBox: "w-full",
                card:
                  "shadow-none border border-zinc-200/70 rounded-2xl bg-white p-6",
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                socialButtonsBlockButton:
                  "border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-smooth press-scale ring-focus",
                formFieldInput:
                  "rounded-lg border-zinc-200 transition-smooth focus:border-accent-500 focus:ring-accent-500/15",
                formButtonPrimary:
                  "bg-accent-600 hover:bg-accent-700 text-white rounded-lg font-semibold transition-smooth press-scale ring-focus",
                footerActionLink:
                  "text-accent-700 hover:text-accent-800 transition-smooth",
              },
            }}
          />
        </div>

        <div className="text-xs text-zinc-400">
          © {new Date().getFullYear()} FenceTrace Inc. · Secured with Clerk
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-accent-950 lg:block">
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 600 800"
          preserveAspectRatio="xMidYMid slice"
        >
          <g
            stroke="#5AA6C6"
            strokeOpacity="0.3"
            strokeWidth="2"
            strokeLinecap="round"
          >
            {RAIN_DROPS.map((r) => (
              <line
                key={`${r.x}-${r.y}`}
                x1={r.x}
                y1={r.y}
                x2={r.x - 5}
                y2={r.y + 16}
                className="anim-rain"
                style={{ animationDelay: r.d }}
              />
            ))}
          </g>
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="anim-enter stagger-1">
            <div className="inline-flex items-center rounded-md border border-white/15 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent-300">
              {pricing.pro.badge || "Free to start"}
            </div>
            <h2 className="mt-8 text-balance text-4xl font-semibold tracking-tight text-white xl:text-5xl">
              <span className="text-accent-300">Quote a job</span>{" "}
              <span className="text-white">in under a minute.</span>
            </h2>
            <p className="mt-4 max-w-md text-white/60">
              Property scans are free on every plan. Pro adds{" "}
              {included} plan takeoffs a month
              {cheapestPack
                ? `, with top-ups from ${packBlurb(cheapestPack)}`
                : ""}
              .
            </p>
          </div>
          <div className="anim-enter stagger-3 grid gap-3 sm:grid-cols-2">
            <Stat n="Free" l="property scans, every plan" />
            <Stat
              n={`${usd(pricing.pro.priceCents)}/mo`}
              l={`${included} plan takeoffs on Pro`}
            />
            {cheapestPack ? (
              <Stat
                n={`$${(cheapestPack.amountCents / cheapestPack.credits / 100).toFixed(2)}`}
                l="per extra plan takeoff"
              />
            ) : (
              <Stat n="Top-ups" l="buy credits anytime" />
            )}
            <Stat n="Cancel" l="anytime" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-lg font-semibold tracking-tight text-white">
        {n}
      </div>
      <div className="text-xs text-accent-300">{l}</div>
    </div>
  );
}
