import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/logo";

/**
 * Shared chrome for public legal pages (/privacy, /terms). Deliberately
 * self-contained — the landing Nav's bare #anchor links would strand a
 * visitor on /privacy, and Google's verification crawler needs these
 * pages to render fully without auth or client JS.
 */
export function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="border-b border-zinc-200/70 bg-white">
        <div className="mx-auto flex h-16 w-full max-w-[860px] items-center justify-between px-5">
          <Link
            href="/"
            aria-label="FenceScan home"
            className="ring-focus rounded-md"
          >
            <Logo showSubtitle={false} />
          </Link>
          <Link
            href="/"
            className="group ring-focus inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-zinc-500 transition-smooth hover:text-zinc-900"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transition-none" />
            Back to home
          </Link>
        </div>
      </header>

      <div className="anim-enter mx-auto w-full max-w-[860px] px-5 py-12 md:py-16">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-accent-600">
          FenceScan legal
        </p>
        <h1 className="mt-2 text-[34px] font-semibold leading-[1.05] tracking-tight text-zinc-900 sm:text-[40px]">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {updated}</p>

        <div className="mt-10 space-y-10">{children}</div>
      </div>

      <footer className="border-t border-zinc-200/70 bg-white">
        <div className="mx-auto flex w-full max-w-[860px] flex-col items-start justify-between gap-2 px-5 py-6 text-xs text-zinc-500 sm:flex-row sm:items-center">
          <p>&copy; {new Date().getFullYear()} FenceScan Inc. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link
              href="/privacy"
              className="ring-focus rounded-sm transition-smooth hover:text-zinc-900"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="ring-focus rounded-sm transition-smooth hover:text-zinc-900"
            >
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

/** One titled section of a legal document, with a stable anchor id. */
export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-zinc-600">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
