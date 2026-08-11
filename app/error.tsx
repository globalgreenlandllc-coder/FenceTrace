"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCcw, TriangleAlert } from "lucide-react";

/**
 * Route-level error boundary — keeps the root layout (fonts, CSS)
 * alive, unlike global-error which replaces the whole document. Any
 * dashboard/portal render throw lands here with a way back.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
        <TriangleAlert className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900">
        Something broke on this page
      </h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        Your data is safe. Try again — if it keeps happening, we&apos;d
        like to know.
        {error.digest && (
          <span className="mt-1 block font-mono text-[11px] text-zinc-400">
            ref: {error.digest}
          </span>
        )}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="ring-focus inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white transition hover:bg-accent-700"
        >
          <RefreshCcw className="h-4 w-4" /> Try again
        </button>
        <Link
          href="/dashboard"
          className="ring-focus inline-flex h-10 items-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
