import { getAbuseOverview, getPolicySummary } from "@/app/actions/abuse";
import { CircuitToggle } from "@/components/admin/circuit-toggle";

export const dynamic = "force-dynamic";

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function pct(spent: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.round((spent / cap) * 100));
}

export default async function AdminAbusePage() {
  const [o, policies] = await Promise.all([getAbuseOverview(), getPolicySummary()]);

  const meters = [
    { label: "Global — last hour", spent: o.spend.hourCents, cap: o.caps.globalHourlyCents },
    { label: "Global — last 24h", spent: o.spend.dayCents, cap: o.caps.globalDailyCents },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
            Abuse guard
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Rate limits, AI spend caps, and the circuit breaker. Estimated costs —
            for capping, not billing.
          </p>
        </div>
        <div className="text-sm text-zinc-500">
          <span className="font-semibold text-zinc-900">{o.limitedLastDay}</span> requests
          rate-limited in the last 24h
        </div>
      </header>

      {/* Circuit breaker */}
      <section
        className={
          o.circuit.open
            ? "rounded-2xl border border-red-200 bg-red-50 p-5"
            : "rounded-2xl border border-emerald-200 bg-emerald-50 p-5"
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              AI circuit breaker
            </div>
            <div className="mt-1 text-2xl font-semibold text-zinc-900">
              {o.circuit.open ? "OPEN — all AI endpoints paused" : "Closed — AI running normally"}
            </div>
            {o.circuit.open ? (
              <p className="mt-1 text-sm text-zinc-600">
                {o.circuit.reason ?? "No reason recorded"}
                {o.circuit.openedAt ? ` · since ${new Date(o.circuit.openedAt).toLocaleString()}` : ""}
                {o.circuit.openedBy ? ` · by ${o.circuit.openedBy}` : ""}
              </p>
            ) : null}
          </div>
          <CircuitToggle open={o.circuit.open} />
        </div>
      </section>

      {/* Spend meters */}
      <section className="grid gap-4 sm:grid-cols-2">
        {meters.map((m) => (
          <div key={m.label} className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-zinc-500">{m.label}</span>
              <span className="text-sm text-zinc-500">
                cap {usd(m.cap)}
              </span>
            </div>
            <div className="mt-1 text-2xl font-semibold text-zinc-900">{usd(m.spent)}</div>
            <div className="mt-3 h-2 w-full rounded-full bg-zinc-100">
              <div
                className={
                  pct(m.spent, m.cap) >= 80
                    ? "anim-grow-x h-2 rounded-full bg-red-500"
                    : "anim-grow-x h-2 rounded-full bg-emerald-500"
                }
                style={{ width: `${pct(m.spent, m.cap)}%` }}
              />
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {/* Spend by kind */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            AI spend by kind — last 24h (7d total {usd(o.spend.weekCents)})
          </h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {o.spend.byKindDay.length === 0 ? (
                <tr>
                  <td className="py-2 text-zinc-400">No spend recorded yet.</td>
                </tr>
              ) : (
                o.spend.byKindDay.map((k) => (
                  <tr key={k.kind} className="transition-smooth border-t border-zinc-100 hover:bg-zinc-50/60">
                    <td className="py-2 font-medium text-zinc-900">{k.kind}</td>
                    <td className="py-2 text-right text-zinc-500">{k.count}×</td>
                    <td className="py-2 text-right font-semibold text-zinc-900">{usd(k.cents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Top users */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Top spenders — last 24h (per-user cap {usd(o.caps.userDailyCents)})
          </h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {o.spend.topUsersDay.length === 0 ? (
                <tr>
                  <td className="py-2 text-zinc-400">No user spend in the last 24h.</td>
                </tr>
              ) : (
                o.spend.topUsersDay.map((u) => (
                  <tr key={u.userId} className="transition-smooth border-t border-zinc-100 hover:bg-zinc-50/60">
                    <td className="py-2 font-medium text-zinc-900">{u.email ?? u.userId}</td>
                    <td className="py-2 text-right text-zinc-500">{u.count}×</td>
                    <td className="py-2 text-right font-semibold text-zinc-900">{usd(u.cents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent events */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Recent abuse events
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">Kind</th>
                <th className="py-2 pr-4">Policy</th>
                <th className="py-2 pr-4">Scope</th>
                <th className="py-2 pr-4">Route</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {o.events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-zinc-400">
                    Nothing yet — that&apos;s a good sign.
                  </td>
                </tr>
              ) : (
                o.events.map((e) => (
                  <tr key={e.id} className="transition-smooth border-t border-zinc-100 align-top hover:bg-zinc-50/60">
                    <td className="whitespace-nowrap py-2 pr-4 text-zinc-500">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 font-medium text-zinc-900">{e.kind}</td>
                    <td className="py-2 pr-4 text-zinc-600">{e.policy ?? "—"}</td>
                    <td className="max-w-[220px] truncate py-2 pr-4 text-zinc-600">
                      {e.scopeKey ?? e.ip ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-600">{e.route ?? "—"}</td>
                    <td className="max-w-[320px] truncate py-2 text-zinc-500">
                      {e.detail ? JSON.stringify(e.detail) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Policy table */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Active rate-limit policies (override via ABUSE_LIMIT_* env)
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="py-2 pr-4">Policy</th>
                <th className="py-2 pr-4">Limits</th>
                <th className="py-2">On limiter error</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.name} className="transition-smooth border-t border-zinc-100 hover:bg-zinc-50/60">
                  <td className="py-2 pr-4 font-medium text-zinc-900">{p.name}</td>
                  <td className="py-2 pr-4 text-zinc-600">{p.rules}</td>
                  <td className="py-2 text-zinc-600">
                    {p.failMode === "closed" ? "block (fail-closed)" : "allow (fail-open)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
