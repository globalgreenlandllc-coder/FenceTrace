"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueRefundForTransaction } from "@/app/actions/admin";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

/** Per-row refund control on /admin/financials. Prompts for an amount
 *  (defaults to the full charge); the server action clamps whatever is
 *  entered to the un-refunded remainder, so an over-typed amount can
 *  never give back more than the customer paid. */
export function RefundButton({
  transactionId,
  grossCents,
}: {
  transactionId: string;
  grossCents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    const raw = window.prompt(
      `Refund amount in dollars (max ${money(grossCents)} — anything higher is clamped to what's left on the charge):`,
      (grossCents / 100).toFixed(2),
    );
    if (raw === null) return;
    const dollars = Number.parseFloat(raw.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError("Enter a positive amount");
      return;
    }
    if (
      !window.confirm(
        `Refund ${money(Math.round(dollars * 100))} to this customer? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await issueRefundForTransaction(
        transactionId,
        Math.round(dollars * 100),
      );
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="transition-smooth rounded-md border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
      >
        {pending ? "Refunding…" : "Refund"}
      </button>
      {error && (
        <span className="max-w-[220px] text-right text-[10px] leading-tight text-rose-600">
          {error}
        </span>
      )}
    </div>
  );
}
