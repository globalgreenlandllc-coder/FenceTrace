"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * financials-shared.tsx — bits shared by the two financials pages:
 * /dashboard/financials (overview: meter, KPIs, profit per job) and
 * /dashboard/financials/setup (overhead list + profit planner). Keeps
 * the tab bar, the hide-numbers eye switch, and money formatting in one
 * place so the pages can't drift apart.
 */

export const usd = (cents: number) => formatCurrency(Math.round(cents) / 100);

/* ------------------------------------------------------------------ */
/*  Tab bar                                                            */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: "overview", href: "/dashboard/financials", label: "Overview" },
  {
    key: "setup",
    href: "/dashboard/financials/setup",
    label: "Overhead & planner",
  },
] as const;

export type FinancialsTab = (typeof TABS)[number]["key"];

export function FinancialsTabs({ active }: { active: FinancialsTab }) {
  return (
    <div className="inline-flex rounded-full border border-zinc-200 bg-white p-1 shadow-sm">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "ring-focus rounded-full px-3.5 py-1.5 text-xs font-medium transition-smooth",
            active === t.key
              ? "bg-accent-600 text-white shadow-sm"
              : "text-zinc-600 hover:text-zinc-900",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hide-numbers eye switch                                            */
/* ------------------------------------------------------------------ */

/** localStorage key — shared by both pages so the choice sticks across tabs. */
const HIDE_MONEY_KEY = "financials.hideMoney";

/** Every money figure on the financials pages renders with .tabular-nums,
 *  so one selector blurs them all (screen-share / over-the-shoulder mode)
 *  without touching the live calculations. */
export const HIDE_MONEY_CLASS =
  "[&_.tabular-nums]:blur-[7px] [&_.tabular-nums]:select-none";

export function useHideMoney(): [boolean, () => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(localStorage.getItem(HIDE_MONEY_KEY) === "1");
  }, []);
  const toggle = () =>
    setHidden((v) => {
      localStorage.setItem(HIDE_MONEY_KEY, v ? "0" : "1");
      return !v;
    });
  return [hidden, toggle];
}

export function HideMoneyToggle({
  hidden,
  onToggle,
}: {
  hidden: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="ring-focus inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-smooth hover:bg-zinc-100 hover:text-zinc-700"
      title={
        hidden
          ? "Show the dollar amounts"
          : "Blur the dollar amounts (for screen sharing)"
      }
    >
      {hidden ? (
        <>
          <Eye className="h-3.5 w-3.5" /> Show numbers
        </>
      ) : (
        <>
          <EyeOff className="h-3.5 w-3.5" /> Hide numbers
        </>
      )}
    </button>
  );
}
