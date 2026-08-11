import Link from "next/link";
import { Fence } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-600 text-white shadow-sm">
        <Fence className="h-7 w-7" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-900">
        This page doesn&apos;t exist
      </h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        The link may be old, mistyped, or the page moved. If someone sent
        you a proposal link, ask them to re-send it.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="ring-focus inline-flex h-10 items-center rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white transition hover:bg-accent-700"
        >
          Go home
        </Link>
        <Link
          href="/dashboard"
          className="ring-focus inline-flex h-10 items-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          My dashboard
        </Link>
      </div>
    </div>
  );
}
