"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { HardHat, CalendarDays, LogOut, Briefcase, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/worker", label: "My jobs", Icon: Briefcase },
  { href: "/worker/schedule", label: "Schedule", Icon: CalendarDays },
  { href: "/worker/pay", label: "Pay", Icon: Wallet },
];

export function WorkerShell({
  name,
  children,
}: {
  name: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { signOut } = useClerk();
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1000px] items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent-600 text-white">
              <HardHat className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-ink">FenceScan</div>
              <div className="text-[11px] text-zinc-400">Crew portal</div>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map(({ href, label, Icon }) => {
              const active = href === "/worker" ? pathname === "/worker" : pathname?.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-smooth ring-focus active:translate-y-px",
                    active ? "bg-zinc-100 text-ink" : "text-zinc-500 hover:text-zinc-800",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
            <button
              onClick={() => signOut({ redirectUrl: "/sign-in" })}
              className="ml-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition-smooth ring-focus hover:bg-zinc-100 hover:text-zinc-800 active:translate-y-px"
              title={name ?? "Sign out"}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1000px] px-4 py-6">{children}</main>
    </div>
  );
}
