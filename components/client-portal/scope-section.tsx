"use client";

import { useMemo } from "react";
import { ClipboardList, Hammer, Package2, Ruler } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  packageClientBreakdown,
  type Proposal,
} from "@/lib/proposal-mock";
import { fenceClientScope } from "@/lib/fence/scope";

/**
 * ScopeSection — the "what am I actually getting?" sheet on the client
 * portal. Reads like the itemized page of a printed estimate: job specs
 * with real sizes, the physical build (posts, concrete, rails — from
 * the SAME takeoff engine that priced the job), and the line items with
 * prices per the proposal's priceDisplay mode.
 *
 * Quantities always show. Whether per-line PRICES show follows the
 * contractor's display choice, exactly like the package cards.
 */
export function ScopeSection({
  proposal,
  selectedPackageId,
}: {
  proposal: Proposal;
  selectedPackageId: string | null;
}) {
  const pkg =
    proposal.packages.find((p) => p.id === selectedPackageId) ??
    proposal.packages.find((p) => p.recommended) ??
    proposal.packages[0];

  const mode = proposal.priceDisplay ?? "totals";

  const scope = useMemo(
    () =>
      pkg?.config.fence
        ? fenceClientScope(pkg.config.fence, proposal.measurements)
        : null,
    [pkg, proposal.measurements],
  );

  const breakdown = useMemo(
    () =>
      pkg
        ? packageClientBreakdown(
            pkg,
            proposal.measurements,
            proposal.discountPct ?? 0,
          )
        : null,
    [pkg, proposal.measurements, proposal.discountPct],
  );

  if (!pkg || (!scope && (!breakdown || breakdown.lines.length === 0))) {
    return null;
  }

  const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const wastePct = Math.round(proposal.measurements.wasteFactorPct ?? 0);

  return (
    <section data-section="scope" className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
          Scope of work
        </h2>
        <span className="truncate text-sm text-zinc-500">
          {pkg.name} — what your price covers
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-card">
        {/* ---- job specs: the sizes ---- */}
        {scope && (
          <div className="border-b border-zinc-100 p-5 sm:p-6">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <Ruler className="h-3.5 w-3.5" /> The job, measured
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-3">
              <SpecRow label="Fence" value={`${scope.spec.typeLabel} · ${scope.spec.heightFt}′ tall`} wide />
              <SpecRow label="Fence length" value={`${qty(scope.spec.netLf)} LF`} />
              <SpecRow label="Sections" value={`${scope.spec.sections} @ ${scope.spec.postSpacingFt}′ spacing`} />
              <SpecRow label="Corners" value={String(scope.spec.corners)} />
              {scope.spec.gates.map((g) => (
                <SpecRow
                  key={g.label}
                  label="Gate"
                  value={g.count > 1 ? `${g.count} × ${g.label}` : g.label}
                />
              ))}
              {scope.spec.steppedSections > 0 && (
                <SpecRow
                  label="Slope"
                  value={`${scope.spec.steppedSections} stepped section${scope.spec.steppedSections === 1 ? "" : "s"}`}
                />
              )}
              {scope.spec.wallTopLf > 0 && (
                <SpecRow label="On retaining wall" value={`${qty(scope.spec.wallTopLf)} LF`} />
              )}
              {scope.spec.removalLf > 0 && (
                <SpecRow label="Old fence removed" value={`${qty(scope.spec.removalLf)} LF`} />
              )}
              {scope.spec.stain && <SpecRow label="Finish" value="Stain & seal, both faces" />}
              {scope.spec.postUpgrade && (
                <SpecRow
                  label="Post upgrade"
                  value={scope.spec.postUpgrade === "steel" ? "Galvanized steel posts" : "Heavy 6×6 posts"}
                />
              )}
            </dl>
          </div>
        )}

        {/* ---- the physical build ---- */}
        {scope && (
          <div className="grid gap-0 border-b border-zinc-100 sm:grid-cols-2">
            <div className="border-b border-zinc-100 p-5 sm:border-b-0 sm:border-r sm:p-6">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                <Package2 className="h-3.5 w-3.5" /> Materials on your job
              </p>
              <ul className="mt-3 space-y-1.5">
                {scope.bom.map((b) => (
                  <li
                    key={b.key}
                    className="flex items-baseline justify-between gap-3 text-sm text-zinc-700"
                  >
                    <span className="min-w-0">{b.label}</span>
                    <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                      {qty(b.qty)} {b.unit}
                    </span>
                  </li>
                ))}
              </ul>
              {wastePct > 0 && (
                <p className="mt-3 text-xs text-zinc-400">
                  Quantities include {wastePct}% cutting waste — the honest
                  amount a real install uses.
                </p>
              )}
            </div>
            <div className="p-5 sm:p-6">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                <Hammer className="h-3.5 w-3.5" /> The crew&apos;s work
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-zinc-700">
                <li className="flex items-baseline justify-between gap-3">
                  <span>
                    Posts set{" "}
                    <span className="text-zinc-400">
                      ({scope.posts.line} line · {scope.posts.corner} corner ·{" "}
                      {scope.posts.end} end
                      {scope.posts.gate > 0 ? ` · ${scope.posts.gate} gate` : ""})
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {scope.posts.total}
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-3">
                  <span>Estimated crew time</span>
                  <span className="shrink-0 tabular-nums font-medium text-zinc-900">
                    {Math.round(scope.laborHours)} hrs
                  </span>
                </li>
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                Layout &amp; string lines, holes dug and posts set in concrete
                {scope.spec.wallTopLf > 0 && " (core-drilled on the wall span)"}
                , rails and {scope.spec.typeLabel.toLowerCase()} installed
                {scope.spec.gates.length > 0 && ", gates hung and latched"}
                {scope.spec.stain && ", stain applied"}, site cleaned and
                haul-away.
              </p>
            </div>
          </div>
        )}

        {/* ---- the itemized price lines ---- */}
        {breakdown && breakdown.lines.length > 0 && (
          <div className="p-5 sm:p-6">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <ClipboardList className="h-3.5 w-3.5" /> Your estimate, line by line
            </p>
            <ul className="mt-3 divide-y divide-zinc-50">
              {breakdown.lines.map((l) => (
                <li
                  key={l.id}
                  className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 text-zinc-700">
                    {l.name}
                    <span className="text-zinc-400">
                      {" "}
                      · {qty(l.quantity)} {l.unit}
                    </span>
                  </span>
                  {mode === "itemized" && (
                    <span className="shrink-0 tabular-nums text-zinc-800">
                      {l.clientPrice === 0 ? "Included" : formatCurrency(l.clientPrice)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {mode !== "totals" ? (
              <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-sm">
                <TotalRow label="Materials & parts" value={formatCurrency(breakdown.materials)} />
                <TotalRow label="Labor & installation" value={formatCurrency(breakdown.labor)} />
                <TotalRow
                  label={
                    pkg.config.fence?.market
                      ? `Sales tax · ${(pkg.config.fence.market.salesTaxRate * 100).toFixed(2)}%${pkg.config.fence.market.state ? ` ${pkg.config.fence.market.state}` : ""}`
                      : "Sales tax"
                  }
                  value={formatCurrency(breakdown.tax)}
                />
                <div className="flex items-baseline justify-between pt-1.5 text-base font-semibold text-zinc-900">
                  <span>Total — {pkg.name}</span>
                  <span className="tabular-nums">{formatCurrency(breakdown.total)}</span>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex items-baseline justify-between border-t border-zinc-100 pt-3 text-base font-semibold text-zinc-900">
                <span>Total — {pkg.name}</span>
                <span className="tabular-nums">{formatCurrency(breakdown.total)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SpecRow({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2 sm:col-span-1")}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-medium text-zinc-800">{value}</dd>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-zinc-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
