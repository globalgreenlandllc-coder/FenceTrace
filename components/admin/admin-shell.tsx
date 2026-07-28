"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBellCounts } from "@/app/actions/notifications";
import { usePathname, useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import {
  Activity,
  ChevronDown,
  CreditCard,
  Database,
  DollarSign,
  Key,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  Palette,
  ShieldAlert,
  Sparkles,
  Tag,
  Users,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MeData } from "@/app/actions/me";

const NAV: { href: string; label: string; icon: typeof LayoutDashboard }[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/analytics", label: "Analytics", icon: Activity },
  { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/financials", label: "Financials", icon: DollarSign },
  { href: "/admin/api-keys", label: "API keys", icon: Key },
  { href: "/admin/pricing", label: "Pricing", icon: Tag },
  { href: "/admin/material-defaults", label: "Material defaults", icon: Palette },
  { href: "/admin/prompts", label: "AI prompts", icon: Sparkles },
  { href: "/admin/abuse", label: "Abuse guard", icon: ShieldAlert },
];

export function AdminShell({
  me,
  children,
}: {
  me: MeData;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useClerk();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Open-support-ticket count → red badge on the Support nav item, polled.
  const [openTickets, setOpenTickets] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getBellCounts().then((c) => alive && setOpenTickets(c.adminTickets));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  async function logout() {
    await signOut();
    router.push("/");
  }

  return (
    <div className="min-h-screen bg-white">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-zinc-200 bg-white transition-transform motion-reduce:transition-none lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <Link href="/admin" className="ring-focus rounded-md">
            <Logo showSubtitle={false} />
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="transition-smooth ring-focus flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-4">
          <Badge tone="rose" className="gap-1.5">
            <ShieldAlert className="h-3 w-3" />
            Super admin
          </Badge>
          <div className="mt-2 truncate text-xs text-zinc-500">
            {me.user.email}
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pt-1">
          {NAV.map((n) => {
            const active =
              n.href === "/admin"
                ? pathname === "/admin"
                : pathname?.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "group relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-smooth ring-focus",
                  active
                    ? "bg-accent-50 font-medium text-accent-800"
                    : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900",
                )}
              >
                <n.icon
                  className={cn(
                    "h-4 w-4 transition-smooth",
                    active
                      ? "text-accent-700"
                      : "text-zinc-400 group-hover:text-zinc-600",
                  )}
                />
                {n.label}
                {n.href === "/admin/support" && openTickets > 0 && (
                  <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                    {openTickets > 9 ? "9+" : openTickets}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-0.5 border-t border-zinc-100 px-3 py-3">
          <Link
            href="/dashboard"
            onClick={() => setMobileOpen(false)}
            className="group transition-smooth ring-focus flex h-9 items-center gap-3 rounded-md px-3 text-sm text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
          >
            <Database className="h-4 w-4 text-zinc-400 transition-smooth group-hover:text-zinc-600" />
            Switch to contractor view
          </Link>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="transition-smooth ring-focus flex h-9 w-9 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            <h1 className="truncate text-[22px] font-semibold tracking-tight text-zinc-900">
              Admin console · FenceScan
            </h1>

            <div className="ml-auto flex items-center gap-2">
              <Badge tone="amber">
                <CreditCard className="h-3 w-3" />
                Production
              </Badge>

              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="transition-smooth ring-focus flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 hover:border-zinc-200 hover:bg-zinc-50"
                >
                  <Avatar
                    initials={initials(me.user.name, me.user.email)}
                  />
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>
                {menuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="anim-pop origin-top-right absolute right-0 z-20 mt-2 w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-elevated">
                      <div className="px-3 py-2">
                        <div className="text-sm font-medium text-zinc-900">
                          {me.user.name}
                        </div>
                        <div className="truncate text-xs text-zinc-500">
                          {me.user.email}
                        </div>
                      </div>
                      <div className="my-1 h-px bg-zinc-100" />
                      <button
                        onClick={logout}
                        className="transition-smooth ring-focus flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

function initials(name: string, email: string) {
  const source = name && name.trim().length > 0 ? name : email;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}
