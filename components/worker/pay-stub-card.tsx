"use client";

import { useState } from "react";
import { ChevronDown, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "./format";
import type { PayStubDTO } from "@/app/actions/worker-jobs";

const METHOD_LABEL: Record<string, string> = {
  CHECK: "check",
  CASH: "cash",
  BANK_TRANSFER: "Zelle/transfer",
  CARD: "card",
  OTHER: "other",
};

/**
 * The worker's own balance with their contractor — the same math the
 * office sees (lib/team-balance.ts), so nobody has to call to ask
 * "when am I getting paid?". One card per contractor (almost always one).
 */
export function PayStubCards({ stubs }: { stubs: PayStubDTO[] }) {
  if (stubs.length === 0) {
    return (
      <div className="anim-enter-fade flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-200 bg-white px-6 py-16 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-zinc-100 text-zinc-400">
          <Wallet className="h-5 w-5" />
        </div>
        <p className="font-medium text-ink">No pay activity yet</p>
        <p className="text-sm text-zinc-500">
          Finish your first job and your earnings show up here.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {stubs.map((s) => (
        <PayStubCard key={s.workerId} stub={s} showCompany={stubs.length > 1} />
      ))}
    </div>
  );
}

function PayStubCard({ stub, showCompany }: { stub: PayStubDTO; showCompany: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="surface rounded-xl border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ring-focus flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          {showCompany && (
            <div className="text-[11px] font-medium text-zinc-600">{stub.company}</div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-zinc-700">
            <span>
              Earned{" "}
              <span className="font-semibold tabular-nums text-ink">
                {fmtMoney(stub.earnedCents)}
              </span>
            </span>
            {stub.pendingCents > 0 && (
              <span>
                Coming up{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {fmtMoney(stub.pendingCents)}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-600">
            {stub.owedCents > 0 ? "Owed to you" : "Settled up"}
          </div>
          <div
            className={cn(
              "text-lg font-semibold tabular-nums",
              stub.owedCents > 0 ? "text-amber-700" : "text-ink",
            )}
          >
            {fmtMoney(Math.max(stub.owedCents, 0))}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-400 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-zinc-100 px-4 py-3 text-sm">
          <p className="text-xs text-zinc-500">
            Job pay settles when the work completes. The amount owed here is
            approved out-of-pocket expenses your contractor still has to pay
            back{stub.expensesOwedCents > 0 ? ` (${fmtMoney(stub.expensesOwedCents)})` : ""}.
          </p>
          {stub.payouts.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Recent payments
              </div>
              <ul className="mt-1.5 space-y-1">
                {stub.payouts.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-baseline justify-between gap-3 text-[13px] text-zinc-700"
                  >
                    <span className="min-w-0 truncate">
                      {new Date(p.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      {p.method ? ` · ${METHOD_LABEL[p.method] ?? p.method}` : ""}
                      {p.note ? ` · ${p.note}` : ""}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">
                      {fmtMoney(p.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
