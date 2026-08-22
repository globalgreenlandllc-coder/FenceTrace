import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { Logo } from "@/components/ui/logo";

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

export default function SignInPage() {
  return (
    <div className="relative grid min-h-screen bg-white lg:grid-cols-2">
      <div className="relative flex flex-col justify-between p-8 sm:p-12">
        <Link href="/" className="ring-focus rounded-md self-start">
          <Logo />
        </Link>

        <div className="anim-enter mx-auto flex w-full max-w-sm flex-col">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Welcome back
          </h1>
          <p className="mt-2 mb-6 text-zinc-600">
            Sign in to continue to your contractor dashboard.
          </p>

          <SignIn
            routing="path"
            path="/sign-in"
            signUpUrl="/sign-up"
            fallbackRedirectUrl="/dashboard"
            appearance={{
              elements: {
                rootBox: "w-full",
                card:
                  "shadow-none border border-zinc-200/70 rounded-2xl bg-white p-6 w-full !min-w-0",
                cardBox: "w-full !min-w-0",
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
                identityPreviewEditButton:
                  "text-accent-700 hover:text-accent-800 transition-smooth",
              },
            }}
          />
        </div>

        <div className="max-w-xs space-y-1.5 text-center text-xs text-zinc-400">
          <p>
            By signing in you agree to our{" "}
            <Link href="/terms" className="underline hover:text-zinc-600">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-zinc-600">
              Privacy Policy
            </Link>
            .
          </p>
          <p>© {new Date().getFullYear()} FenceScan Inc. · Secured with Clerk</p>
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
              Built for fence contractors
            </div>
            <h2 className="mt-8 text-balance text-4xl font-semibold tracking-tight text-white xl:text-5xl">
              <span className="text-accent-300">Address-to-accepted</span>{" "}
              <span className="text-white">in under a minute.</span>
            </h2>
            <p className="mt-4 max-w-md text-white/60">
              FenceScan measures the property line from satellite imagery and
              county records, packages a proposal, and collects the deposit —
              all from your truck.
            </p>
          </div>

          <div className="anim-enter stagger-3 grid gap-3 sm:grid-cols-2">
            <Stat n="148 LF" l="auto-measured fence line" />
            <Stat n="3 packages" l="Good · Better · Best" />
            <Stat n="±2%" l="vs ground truth" />
            <Stat n="1-click" l="accept & pay" />
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
