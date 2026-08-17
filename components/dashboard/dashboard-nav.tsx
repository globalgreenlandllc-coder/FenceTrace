"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnnouncementBanner } from "@/components/announcements/announcement-banner";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronsUpDown,
  Fence,
  FileText,
  HardHat,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  MapPin,
  Menu,
  PartyPopper,
  Plus,
  Ruler,
  Search,
  Settings,
  ShieldAlert,
  User,
  Users,
  Wallet,
  X,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { Logo } from "@/components/ui/logo";
import { Avatar } from "@/components/ui/avatar";
import { BrandMark } from "@/components/ui/brand-mark";
import { CreditsChip } from "./credits-chip";
import { NotificationsBell } from "./notifications-bell";
import { useSession } from "@/lib/auth-mock";
import { cn } from "@/lib/utils";

type NavIcon = typeof LayoutGrid;
type NavEntry = {
  href: string;
  label: string;
  Icon: NavIcon;
  /** Tint the row in brand green even when it isn't the active route —
   *  reserved for the estimator, the one entry that starts real work. */
  featured?: boolean;
};

const NAV_GROUPS: { label: string; items: NavEntry[] }[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard", label: "Overview", Icon: LayoutGrid },
      { href: "/dashboard/proposals", label: "Proposals", Icon: FileText },
      // Tape-measure proposals — no plans, address won't scan; the
      // contractor measured on site, types the numbers in, and sends
      // the proposal from the same page (separate from the AI builder).
      { href: "/dashboard/measure", label: "Manual proposal", Icon: Ruler },
      // Fully-paid jobs — the proposals list pre-filtered to Done.
      { href: "/dashboard/proposals?filter=done", label: "Done jobs", Icon: PartyPopper },
      { href: "/dashboard/leads", label: "Leads", Icon: MapPin },
      { href: "/dashboard/clients", label: "Clients", Icon: Users },
      // Overhead + per-job profit — the contractor's own P&L, never client-facing.
      { href: "/dashboard/financials", label: "Financials", Icon: Wallet },
    ],
  },
  {
    label: "Delivery",
    items: [
      { href: "/dashboard/calendar", label: "Calendar", Icon: CalendarDays },
      { href: "/dashboard/workers", label: "Workers", Icon: HardHat },
    ],
  },
  {
    label: "Tools",
    items: [
      // Not an AI feature — the takeoff is measured and computed, so it
      // carries a fence, never the sparkle we reserve for AI surfaces.
      { href: "/estimate", label: "Fence estimator", Icon: Fence, featured: true },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard/settings", label: "Settings", Icon: Settings },
      { href: "/dashboard/support", label: "Help & support", Icon: LifeBuoy },
    ],
  },
];

function isActive(pathname: string | null, href: string) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : Boolean(pathname?.startsWith(href));
}

function NavItem({
  href,
  label,
  Icon,
  active,
  featured,
  collapsed = false,
}: NavEntry & {
  active: boolean;
  /** Icon-only rail mode — label becomes a native tooltip. */
  collapsed?: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "transition-smooth ring-focus flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium",
        collapsed && "justify-center px-0 py-2",
        active
          ? "bg-accent-50 text-accent-800"
          : featured
            ? // Resting state still reads green, with a hairline so the row
              //  has an edge against the plain items above it.
              "bg-accent-50/60 text-accent-800 ring-1 ring-inset ring-accent-100 hover:bg-accent-50 hover:ring-accent-200"
            : "text-zinc-600 hover:bg-zinc-100/70 hover:text-zinc-900",
        featured && "font-semibold",
      )}
    >
      <Icon
        className={cn(
          "transition-smooth h-4 w-4",
          active || featured ? "text-accent-700" : "text-zinc-400",
        )}
      />
      {!collapsed && label}
    </Link>
  );
}

function AccountMenu({ align = "up" }: { align?: "up" | "down" }) {
  const router = useRouter();
  const { signOut } = useClerk();
  const { session } = useSession();
  const [open, setOpen] = useState(false);

  async function logout() {
    await signOut();
    router.push("/");
  }

  return (
    <div className="relative">
      {align === "down" ? (
        // Compact trigger for the topbar: avatar only.
        <button
          onClick={() => setOpen((v) => !v)}
          className="ring-focus transition-smooth flex items-center rounded-md hover:opacity-90"
          aria-label="Account menu"
        >
          <Avatar initials={session?.user.initials ?? "?"} />
        </button>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          className="ring-focus transition-smooth flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-zinc-200 hover:bg-zinc-50"
        >
          <Avatar initials={session?.user.initials ?? "?"} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-zinc-900">
              {session?.user.name ?? "—"}
            </div>
            <div className="truncate text-[11px] text-zinc-500">
              {session?.profile.company ?? ""}
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "anim-pop absolute z-20 w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-elevated",
              align === "up"
                ? "origin-bottom-left bottom-full left-0 mb-2"
                : "origin-top-right right-0 top-full mt-2",
            )}
          >
            <MenuItem icon={User} label="Profile" href="/dashboard/settings" />
            <MenuItem
              icon={Settings}
              label="Settings"
              href="/dashboard/settings"
            />
            {session?.user.role === "SUPER_ADMIN" && !session?.impersonation && (
              <>
                <div className="my-1 h-px bg-zinc-100" />
                <Link
                  href="/admin"
                  className="transition-smooth ring-focus flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                >
                  <ShieldAlert className="h-4 w-4" />
                  Admin console
                </Link>
              </>
            )}
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
  );
}

/**
 * Mobile slide-in nav drawer, opened by the topbar hamburger. Renders the
 * same grouped nav as the desktop sidebar so the two never drift, closes on
 * backdrop tap / Escape / route change, and locks body scroll while open.
 */
function MobileNavDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  // Route change closes the drawer; the <nav> click delegation below covers
  // the same-page tap where pathname never changes.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div
      className={cn("fixed inset-0 z-50 lg:hidden", !open && "pointer-events-none")}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-zinc-900/40 transition-opacity duration-200 motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-white shadow-elevated transition-transform duration-200 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200/70 pl-5 pr-2">
          <Link href="/dashboard" className="ring-focus rounded-md">
            <Logo showSubtitle={false} />
          </Link>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ring-focus transition-smooth grid h-10 w-10 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav
          className="flex-1 overflow-y-auto px-3 py-4"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) onClose();
          }}
        >
          <Link
            href="/dashboard/proposals/new"
            className="ring-focus transition-smooth press-scale mb-4 flex h-10 items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-700"
          >
            <Plus className="h-4 w-4" />
            New Proposal
          </Link>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mt-5 first:mt-0">
              <div className="microlabel mb-1.5 px-2.5">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map((n) => (
                  <NavItem
                    key={n.href}
                    {...n}
                    active={isActive(pathname, n.href)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-zinc-200/70 p-3">
          <AccountMenu align="up" />
        </div>
      </div>
    </div>
  );
}

function CompanyChip() {
  const { session } = useSession();
  const company = session?.profile.company;
  if (!company) return null;
  const logo = session.profile.logo;
  return (
    <div className="hidden items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-700 xl:flex">
      <BrandMark
        initials={logo.initials}
        tone={logo.tone}
        logoUrl={logo.url}
        size="sm"
        className="h-5 w-5 rounded-md text-[8px] shadow-none"
      />
      <span className="max-w-[160px] truncate">{company}</span>
    </div>
  );
}

/**
 * Contractor-OS app shell: fixed white sidebar with grouped nav (WORK /
 * DELIVERY / TOOLS / ACCOUNT), a slim white topbar (search, company chip,
 * new-proposal CTA, credits, notifications, account), and page content on
 * the warm paper canvas.
 *
 * Pages render everything inside <DashboardShell title="…" actions={…}>.
 * `eyebrow` renders a microlabel above the title; `subtitle` a muted line
 * below it. `fullBleed` drops the padded max-width container (maps, canvases).
 */
export function DashboardShell({
  title,
  eyebrow,
  subtitle,
  actions,
  children,
  fullBleed = false,
  contentClassName,
}: {
  title?: string;
  eyebrow?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  fullBleed?: boolean;
  contentClassName?: string;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Collapsed = icon rail (64px) instead of the full 224px sidebar —
  // more room for canvases and tables. Persisted so it survives
  // navigation and reloads; applied after mount so SSR and the first
  // client render agree (the expanded default just flashes for a beat).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem("fencescan.sidebarCollapsed") === "1");
  }, []);
  const toggleSidebar = () => {
    setCollapsed((c) => {
      localStorage.setItem("fencescan.sidebarCollapsed", c ? "0" : "1");
      return !c;
    });
  };

  return (
    <div className="min-h-screen bg-paper">
      {/* Sidebar (desktop) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-zinc-200/70 bg-white transition-[width] duration-200 motion-reduce:transition-none lg:flex",
          collapsed ? "w-16" : "w-[224px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-zinc-200/70",
            collapsed ? "justify-center px-0" : "px-5",
          )}
        >
          <Link href="/dashboard" className="ring-focus rounded-md" title="FenceScan">
            {collapsed ? (
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-600 text-white">
                <Fence className="h-5 w-5" />
              </span>
            ) : (
              <Logo showSubtitle={false} />
            )}
          </Link>
        </div>
        <nav className={cn("flex-1 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mt-5 first:mt-0">
              {collapsed ? (
                <div className="mx-2 mb-1.5 border-t border-zinc-200/70 first:hidden" />
              ) : (
                <div className="microlabel mb-1.5 px-2.5">{group.label}</div>
              )}
              <div className="space-y-0.5">
                {group.items.map((n) => (
                  <NavItem
                    key={n.href}
                    {...n}
                    active={isActive(pathname, n.href)}
                    collapsed={collapsed}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        {!collapsed && (
          <div className="border-t border-zinc-200/70 p-3">
            <AccountMenu align="up" />
          </div>
        )}
        {/* Fold handle — mid-edge, like a drawer pull. */}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="ring-focus transition-smooth absolute -right-3 top-1/2 z-50 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm hover:text-zinc-700 hover:shadow"
        >
          {collapsed ? (
            <ChevronsRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronsLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </aside>

      {/* Content column */}
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-200 motion-reduce:transition-none",
          collapsed ? "lg:pl-16" : "lg:pl-[224px]",
        )}
      >
        {/* Mobile top bar */}
        <div className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white lg:hidden">
          <div className="flex h-14 items-center gap-1 pl-1.5 pr-4">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="ring-focus transition-smooth grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/dashboard" className="ring-focus min-w-0 rounded-md">
              <Logo showSubtitle={false} />
            </Link>
            <div className="flex flex-1 items-center justify-end gap-2">
              <CreditsChip />
              <NotificationsBell />
              <AccountMenu align="down" />
            </div>
          </div>
        </div>
        <MobileNavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

        {/* Topbar (desktop) */}
        <header className="sticky top-0 z-30 hidden h-14 shrink-0 items-center gap-3 border-b border-zinc-200/70 bg-white px-4 sm:px-6 lg:flex">
          {/* Decorative search chip per the shell spec — not a live
              input, so it can't silently swallow typed queries. */}
          <div className="flex h-9 w-72 items-center rounded-lg bg-zinc-100/80 px-3 text-[13px] text-zinc-500">
            <Search className="mr-2 h-4 w-4 shrink-0 text-zinc-400" />
            <span className="w-full select-none text-zinc-400">
              Search proposals, clients…
            </span>
            <kbd className="ml-2 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              ⌘K
            </kbd>
          </div>
          <div className="flex flex-1 items-center justify-end gap-2">
            <CompanyChip />
            <Link
              href="/dashboard/proposals/new"
              className="ring-focus transition-smooth press-scale inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-accent-700"
            >
              <Plus className="h-4 w-4" />
              New Proposal
            </Link>
            <CreditsChip />
            <NotificationsBell />
            <AccountMenu align="down" />
          </div>
        </header>

        {/* Mobile page title + actions */}
        {(title || actions) && (
          <div className="flex items-center justify-between gap-3 border-b border-zinc-200/70 bg-paper px-4 py-3 lg:hidden">
            <div className="min-w-0">
              {eyebrow && <div className="microlabel">{eyebrow}</div>}
              <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-900">
                {title}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          </div>
        )}

        {fullBleed ? (
          <div className={cn("flex-1 bg-paper", contentClassName)}>
            {children}
          </div>
        ) : (
          <div className="flex-1 bg-paper lg:min-h-[calc(100vh-3.5rem)]">
            <main
              className={cn(
                // The freed sidebar width must reach the CONTENT, not
                // become empty margin — the max-width cap grows by the
                // same ~160px the rail gives back.
                "mx-auto w-full px-4 py-8 transition-[max-width] duration-200 motion-reduce:transition-none sm:px-6",
                collapsed ? "max-w-[1360px]" : "max-w-[1200px]",
                contentClassName,
              )}
            >
              <AnnouncementBanner />
              {title ? (
                <>
                  <div className="hidden lg:block">
                    {eyebrow && <div className="microlabel mb-2">{eyebrow}</div>}
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h1 className="text-[28px] font-semibold tracking-tight text-zinc-900 sm:text-[32px]">
                          {title}
                        </h1>
                        {subtitle && (
                          <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
                        )}
                      </div>
                      {actions && (
                        <div className="flex items-center gap-2">{actions}</div>
                      )}
                    </div>
                  </div>
                  <div className="lg:mt-6">{children}</div>
                </>
              ) : (
                children
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="transition-smooth ring-focus flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
    >
      <Icon className="h-4 w-4 text-zinc-500" />
      {label}
    </Link>
  );
}
