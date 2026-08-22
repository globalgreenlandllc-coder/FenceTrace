import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Container } from "./ui";

// Every link goes somewhere real — a verifier (Google OAuth, ad platforms)
// clicks these, and a "Blog" that lands on a sign-in wall reads as a
// placeholder site. Sections link their landing anchors; legal pages are
// their own routes; Contact is a mailto.
const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Takeoffs", href: "/#takeoffs" },
      { label: "Trace Engine", href: "/#engine" },
      { label: "Proposals", href: "/#proposals" },
      { label: "Platform", href: "/#platform" },
      { label: "Pricing", href: "/#pricing" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "For Contractors", href: "/#platform" },
      { label: "Business Insights", href: "/#insights" },
      { label: "Free property scan", href: "/#scan" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Contact", href: "mailto:info@fencescan.com" },
      { label: "Support", href: "mailto:info@fencescan.com" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Cookies", href: "/privacy#cookies" },
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
          <p>&copy; 2026 FenceScan Inc. All rights reserved.</p>
          <div className="flex items-center gap-5">
            <Link
              href="/privacy"
              className="ring-focus rounded-sm transition hover:text-zinc-900"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="ring-focus rounded-sm transition hover:text-zinc-900"
            >
              Terms
            </Link>
            <Link
              href="/privacy#cookies"
              className="ring-focus rounded-sm transition hover:text-zinc-900"
            >
              Cookies
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
