import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Container } from "./ui";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Takeoffs", href: "/sign-in" },
      { label: "Estimates", href: "/sign-in" },
      { label: "Proposals", href: "/sign-in" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Trace Engine", href: "/sign-in" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "For Contractors", href: "/sign-in" },
      { label: "For Franchises", href: "/sign-in" },
      { label: "FAQ", href: "/sign-in" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Blog", href: "/sign-in" },
      { label: "About Us", href: "/sign-in" },
      { label: "Careers", href: "/sign-in" },
      { label: "Contact", href: "/sign-in" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-paper pt-16">
      <Container>
        <div className="grid gap-12 border-b border-zinc-200 pb-14 md:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <Logo showSubtitle={false} />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                Patent Pending
              </span>
            </div>
            <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-zinc-500">
              The platform fence contractors run their business on &mdash;
              takeoffs, proposals, scheduling, and payments.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <span className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                SOC 2
              </span>
              <span className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                Built on Aerial + Parcel Data
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                  {col.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="ring-focus rounded-sm text-[13.5px] text-zinc-600 transition hover:text-zinc-900"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 py-6 text-[12px] text-zinc-500 md:flex-row">
          <p>&copy; 2026 FenceTrace Inc. All rights reserved.</p>
          <div className="flex items-center gap-5">
            <Link
              href="/sign-in"
              className="ring-focus rounded-sm transition hover:text-zinc-900"
            >
              Service Status
            </Link>
            <Link
              href="/sign-in"
              className="ring-focus rounded-sm transition hover:text-zinc-900"
            >
              Security
            </Link>
            <Link
              href="/sign-in"
              aria-label="LinkedIn"
              className="ring-focus flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8h4V24h-4V8zm7.5 0h3.8v2.2h.05c.53-1 1.83-2.2 3.77-2.2 4.03 0 4.88 2.65 4.88 6.1V24h-4v-8.5c0-2.03-.04-4.64-2.83-4.64-2.83 0-3.27 2.2-3.27 4.5V24H8V8z" />
              </svg>
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
