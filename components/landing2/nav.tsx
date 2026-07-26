import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { Container } from "./ui";

const LINKS = [
  { label: "Product", href: "#engine" },
  { label: "Contractors", href: "#takeoffs" },
  { label: "Proposals", href: "#proposals" },
  { label: "Platform", href: "#platform" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Insights", href: "#insights" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-paper/95 backdrop-blur">
      <Container className="flex h-[64px] items-center justify-between">
        <div className="flex items-center gap-10">
          <Link href="/" className="shrink-0">
            <Logo showSubtitle={false} />
          </Link>
          <nav className="hidden items-center gap-7 lg:flex">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="ring-focus rounded-sm text-[13.5px] font-medium text-zinc-600 transition hover:text-zinc-900"
              >
                {l.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="ring-focus rounded-sm text-[13.5px] font-medium text-zinc-600 transition hover:text-zinc-900"
          >
            Sign in
          </Link>
          <Link
            href="/sign-in"
            className="ring-focus inline-flex h-9 items-center rounded-lg bg-accent-600 px-4 text-[13px] font-semibold text-white shadow-sm transition hover:bg-accent-700 active:scale-[0.98] motion-reduce:transform-none"
          >
            Get Started
          </Link>
        </div>
      </Container>
    </header>
  );
}
