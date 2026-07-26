"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

/**
 * Error boundary for /estimate (and everything nested under it).
 *
 * Next.js production builds strip the actual error message to avoid
 * leaking server internals. That's safer, but when something is broken
 * specifically on Vercel and the dev never reproduces it locally, you
 * end up with the contractor staring at a generic "Server Components
 * render" 500 and no way to forward a useful bug report.
 *
 * This boundary surfaces the digest + message in-page so the user can
 * screenshot it back to us OR look it up in Vercel's runtime logs (the
 * digest is the line key Vercel uses to associate console errors with
 * specific function invocations).
 */
export default function EstimateError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the full stack in the browser console too — production
    // builds otherwise hide it.
    console.error("[/estimate boundary]", error);
  }, [error]);

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-paper px-4">
      {/* Same entrance as the in-page ErrorScreen/LoadingState cards so a
          crash lands with the surface's one motion language. */}
      <div className="anim-enter relative w-full max-w-xl">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-rose-200 bg-white p-8 shadow-card">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
                Something broke on the estimate page
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                The page failed to render. Details below — screenshot this if
                you need to file a bug.
              </p>
            </div>
          </div>

          <dl className="mt-5 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm">
            <div>
              <dt className="microlabel">Message</dt>
              <dd className="mt-1 break-words font-mono text-[13px] text-zinc-800">
                {error.message || "(empty)"}
              </dd>
            </div>
            {error.digest && (
              <div>
                <dt className="microlabel">Digest</dt>
                <dd className="mt-1 font-mono text-[13px] text-zinc-800">
                  {error.digest}
                </dd>
                <p className="mt-1 text-xs text-zinc-500">
                  Look this up in Vercel → Logs to see the full server-side
                  stack.
                </p>
              </div>
            )}
          </dl>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button onClick={reset} className="flex-1">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <Link href="/dashboard" className="flex-1">
              <Button variant="secondary" className="w-full">
                <ArrowLeft className="h-4 w-4" />
                Back to dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
