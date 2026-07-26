import { Landmark, Repeat, TrendingUp, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getAdminFinancials } from "@/app/actions/admin";
import { RefundButton } from "./refund-button";

export const dynamic = "force-dynamic";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const TYPE_LABEL: Record<string, { label: string; tone: "accent" | "violet" | "emerald" | "neutral" | "rose" | "sky" | "amber" }> = {
  SUBSCRIPTION: { label: "Subscription", tone: "accent" },
  CREDIT_TOPUP: { label: "Credit top-up", tone: "violet" },
  PROPOSAL_DEPOSIT: { label: "Proposal deposit", tone: "sky" },
  PROPOSAL_FINAL: { label: "Proposal final", tone: "sky" },
  REFUND: { label: "Refund", tone: "rose" },
};

export default async function AdminFinancialsPage() {
  const fin = await getAdminFinancials();
  const empty = fin.transactions.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Financials
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Platform revenue — subscriptions and credit packs, written by the
          Stripe webhook.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <Cell
          label="MRR"
          value={money(fin.mrrCents)}
          sub={`${fin.activeSubs} active subscription${fin.activeSubs === 1 ? "" : "s"}${fin.pastDueSubs > 0 ? ` · ${fin.pastDueSubs} past due` : ""}`}
          Icon={Repeat}
        />
        <Cell
          label="Revenue · 30 days"
          value={money(fin.revenue30dCents)}
          sub={`${money(fin.subscriptionRevenue30dCents)} subs · ${money(fin.creditRevenue30dCents)} credits${fin.refunds30dCents !== 0 ? ` · ${money(fin.refunds30dCents)} refunds` : ""}`}
          Icon={TrendingUp}
        />
        <Cell
          label="Credit packs · 30 days"
          value={money(fin.creditRevenue30dCents)}
          Icon={Zap}
        />
        <Cell
          label="All-time revenue"
          value={money(fin.allTimeRevenueCents)}
          Icon={Landmark}
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-card">
        <div className="border-b border-zinc-100 px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900">
            Recent transactions
          </h2>
        </div>
        {empty ? (
          <div className="px-6 py-14 text-center">
            <div className="text-sm font-medium text-zinc-900">
              No transactions yet
            </div>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
              Rows appear here as soon as Stripe is live: add STRIPE_SECRET and
              STRIPE_WEBHOOK in /admin/api-keys, point a Stripe webhook at
              /api/webhooks/stripe (events: checkout.session.completed,
              invoice.paid, invoice.payment_failed, customer.subscription.*,
              charge.refunded), and the first Pro upgrade or credit purchase
              will land in this ledger.
            </p>
          </div>
        ) : (
          <>
            <div className="font-label hidden grid-cols-[minmax(0,1fr)_150px_120px_110px_130px_80px] gap-4 px-5 py-2.5 text-[11px] text-zinc-400 lg:grid">
              <div>Customer · Description</div>
              <div>Type</div>
              <div>Status</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Date</div>
              <div />
            </div>
            <ul>
              {fin.transactions.map((t) => {
                const type = TYPE_LABEL[t.type] ?? {
                  label: t.type,
                  tone: "neutral" as const,
                };
                return (
                  <li
                    key={t.id}
                    className="transition-smooth grid grid-cols-1 gap-1 border-t border-zinc-100 px-5 py-3 hover:bg-zinc-50/60 lg:grid-cols-[minmax(0,1fr)_150px_120px_110px_130px_80px] lg:items-center lg:gap-4"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-900">
                        {t.userEmail}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        {t.description ?? "—"}
                      </div>
                    </div>
                    <div>
                      <Badge tone={type.tone}>{type.label}</Badge>
                    </div>
                    <div>
                      <Badge
                        tone={
                          t.status === "SUCCEEDED"
                            ? "emerald"
                            : t.status === "FAILED"
                              ? "rose"
                              : t.status === "REFUNDED"
                                ? "amber"
                                : "neutral"
                        }
                      >
                        {t.status.toLowerCase()}
                      </Badge>
                    </div>
                    <div className="text-right text-sm font-semibold tabular-nums text-zinc-900">
                      {money(t.grossCents)}
                    </div>
                    <div className="text-right text-xs text-zinc-500">
                      {new Date(t.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </div>
                    <div className="flex justify-end">
                      {t.refundable && (
                        <RefundButton
                          transactionId={t.id}
                          grossCents={t.grossCents}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-500">{label}</div>
        <Icon className="h-4 w-4 text-zinc-300" />
      </div>
      <div className="mt-2 text-[26px] font-semibold tabular-nums tracking-tight text-zinc-900">
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}
