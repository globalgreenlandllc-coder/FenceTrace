"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Eye,
  MoreHorizontal,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  UserCog,
  UserMinus,
  UserPlus,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import {
  adjustCredits,
  setUserRole,
  setUserStatus,
  setUserTier,
  startImpersonation,
  type AdminUserRow,
  type UserTier,
} from "@/app/actions/admin";

const TIER_META: Record<
  UserTier,
  { label: string; tone: "emerald" | "sky" | "neutral" }
> = {
  pro: { label: "Pro", tone: "emerald" },
  trial: { label: "Trial", tone: "sky" },
  free: { label: "Free", tone: "neutral" },
};

const ROLE_LABEL: Record<AdminUserRow["role"], string> = {
  CONTRACTOR: "Contractor",
  WORKER: "Worker",
  SUPER_ADMIN: "Admin",
};

export function UsersTable({
  rows: initial,
  initialQuery = "",
}: {
  rows: AdminUserRow[];
  initialQuery?: string;
}) {
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<
    "all" | "active" | "suspended" | "admin" | "no_payments"
  >("all");
  const [query, setQuery] = useState(initialQuery);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [confirm, setConfirm] = useState<{
    user: AdminUserRow;
    action: "suspend" | "unsuspend";
  } | null>(null);
  const [impersonating, setImpersonating] = useState<AdminUserRow | null>(null);
  const [changingRole, setChangingRole] = useState<AdminUserRow | null>(null);
  const [changingPlan, setChangingPlan] = useState<AdminUserRow | null>(null);

  const filtered = rows.filter((r) => {
    if (filter === "active" && r.status !== "ACTIVE") return false;
    if (filter === "suspended" && r.status !== "SUSPENDED") return false;
    if (filter === "admin" && r.role !== "SUPER_ADMIN") return false;
    if (filter === "no_payments" && (r.payments.stripe || r.payments.square))
      return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      r.email.toLowerCase().includes(q) ||
      r.company.toLowerCase().includes(q) ||
      r.contractorName.toLowerCase().includes(q)
    );
  });

  function applyRowUpdate(u: AdminUserRow) {
    setRows((prev) => prev.map((r) => (r.id === u.id ? u : r)));
  }

  return (
    <>
      <div className="surface overflow-hidden shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 p-4">
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: "all", label: "All" },
                { id: "active", label: "Active" },
                { id: "suspended", label: "Suspended" },
                { id: "admin", label: "Admins" },
                { id: "no_payments", label: "No payments" },
              ] as const
            ).map((f) => {
              const count =
                f.id === "all"
                  ? rows.length
                  : f.id === "active"
                  ? rows.filter((r) => r.status === "ACTIVE").length
                  : f.id === "suspended"
                  ? rows.filter((r) => r.status === "SUSPENDED").length
                  : f.id === "admin"
                  ? rows.filter((r) => r.role === "SUPER_ADMIN").length
                  : rows.filter(
                      (r) => !r.payments.stripe && !r.payments.square,
                    ).length;
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "transition-smooth ring-focus inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium",
                    active
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] tabular-nums",
                      active
                        ? "bg-white/15 text-white"
                        : "bg-zinc-100 text-zinc-500",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="transition-smooth relative flex h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-sm focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/15">
            <Search className="mr-2 h-4 w-4 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email, name, company…"
              className="w-56 bg-transparent text-zinc-900 outline-none placeholder:text-zinc-400"
            />
          </div>
        </div>

        <div className="font-label hidden grid-cols-[minmax(0,1fr)_120px_110px_120px_120px_110px_60px] gap-4 border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-400 lg:grid">
          <div>Contractor · Email</div>
          <div>Plan</div>
          <div className="text-right">Credits</div>
          <div className="text-right">Activity</div>
          <div>Payments</div>
          <div>Status</div>
          <div />
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <UsersIcon className="mx-auto h-8 w-8 text-zinc-300" />
            <div className="mt-3 text-sm text-zinc-500">
              No contractors match these filters.
            </div>
          </div>
        ) : (
          <ul>
            {filtered.map((u) => (
              <li key={u.id} className="border-b border-zinc-100 last:border-0">
                <div className="transition-smooth grid grid-cols-1 gap-2 px-4 py-3.5 hover:bg-zinc-50/60 lg:grid-cols-[minmax(0,1fr)_120px_110px_120px_120px_110px_60px] lg:items-center lg:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-zinc-900">
                        {u.company || u.contractorName || u.email}
                      </span>
                      {u.role === "SUPER_ADMIN" && (
                        <Badge tone="violet">Admin</Badge>
                      )}
                      {u.role === "WORKER" && <Badge tone="sky">Worker</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">
                      {u.email}
                      {u.contractorName && u.contractorName !== u.company && (
                        <span className="ml-1 text-zinc-400">
                          · {u.contractorName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-zinc-600">
                    {u.subscriptionStatus === "PAST_DUE" ? (
                      // A declining card reads as an at-risk account, not a
                      // healthy "Pro" — matches the user's own settings badge.
                      <Badge tone="amber">
                        <AlertTriangle className="h-3 w-3" />
                        Payment failed
                      </Badge>
                    ) : (
                      <Badge tone={TIER_META[u.tier].tone}>
                        {TIER_META[u.tier].label}
                      </Badge>
                    )}
                    <div className="mt-1 text-zinc-400">
                      Joined{" "}
                      {new Date(u.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                  </div>

                  <div className="text-right text-sm tabular-nums text-zinc-900">
                    {u.remaining}
                    <span className="text-zinc-400"> / {u.creditsIncluded + u.creditsBonus}</span>
                    {u.creditsBonus > 0 && (
                      <div className="text-[10px] text-accent-700">
                        +{u.creditsBonus} bonus
                      </div>
                    )}
                  </div>

                  <div className="text-right text-xs text-zinc-500">
                    <div className="text-zinc-700">
                      {u.acceptedTotal}/{u.proposalsTotal} accepted
                    </div>
                    <div>{formatCurrency(u.revenueProcessedCents / 100)}</div>
                  </div>

                  <PaymentsBadge payments={u.payments} />

                  <StatusBadge status={u.status} />

                  <div className="flex items-center justify-end">
                    <RowMenu
                      user={u}
                      onEditCredits={() => setEditing(u)}
                      onImpersonate={() => setImpersonating(u)}
                      onChangeRole={() => setChangingRole(u)}
                      onChangePlan={() => setChangingPlan(u)}
                      onConfirmStatus={(action) => setConfirm({ user: u, action })}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreditsDialog
        user={editing}
        onClose={() => setEditing(null)}
        onApplied={(updated) => {
          applyRowUpdate(updated);
          setEditing(null);
        }}
      />

      <StatusConfirm
        confirm={confirm}
        onClose={() => setConfirm(null)}
        onApplied={(updated) => {
          applyRowUpdate(updated);
          setConfirm(null);
        }}
      />

      <ImpersonateDialog
        user={impersonating}
        onClose={() => setImpersonating(null)}
      />

      <RoleDialog
        user={changingRole}
        onClose={() => setChangingRole(null)}
        onApplied={(updated) => {
          applyRowUpdate(updated);
          setChangingRole(null);
        }}
      />

      <PlanDialog
        user={changingPlan}
        onClose={() => setChangingPlan(null)}
        onApplied={(updated) => {
          applyRowUpdate(updated);
          setChangingPlan(null);
        }}
      />
    </>
  );
}

function StatusBadge({ status }: { status: AdminUserRow["status"] }) {
  if (status === "SUSPENDED") {
    return (
      <Badge tone="rose">
        <AlertTriangle className="h-3 w-3" />
        Suspended
      </Badge>
    );
  }
  return (
    <Badge tone="emerald">
      <CheckCircle2 className="h-3 w-3" />
      Active
    </Badge>
  );
}

function PaymentsBadge({ payments }: { payments: AdminUserRow["payments"] }) {
  const { stripe, square } = payments;
  if (!stripe && !square) {
    return (
      <Badge tone="amber" className="gap-1">
        <CreditCard className="h-3 w-3" />
        None
      </Badge>
    );
  }
  const labels = [stripe && "Stripe", square && "Square"]
    .filter(Boolean)
    .join(" + ");
  return (
    <Badge tone="emerald" className="gap-1">
      <CreditCard className="h-3 w-3" />
      {labels}
    </Badge>
  );
}

function RowMenu({
  user,
  onEditCredits,
  onImpersonate,
  onChangeRole,
  onChangePlan,
  onConfirmStatus,
}: {
  user: AdminUserRow;
  onEditCredits: () => void;
  onImpersonate: () => void;
  onChangeRole: () => void;
  onChangePlan: () => void;
  onConfirmStatus: (action: "suspend" | "unsuspend") => void;
}) {
  const [open, setOpen] = useState(false);
  const isAdmin = user.role === "SUPER_ADMIN";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="transition-smooth ring-focus flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
        aria-label="Actions"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="anim-pop origin-top-right absolute right-0 z-20 mt-1 w-52 rounded-xl border border-zinc-200 bg-white p-1 shadow-elevated">
            <button
              onClick={() => {
                onChangePlan();
                setOpen(false);
              }}
              className="transition-smooth ring-focus flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              <Tag className="h-3.5 w-3.5 text-accent-600" />
              Change plan
            </button>
            <button
              onClick={() => {
                onChangeRole();
                setOpen(false);
              }}
              disabled={isAdmin}
              title={
                isAdmin
                  ? "Admins are managed via the ADMIN_EMAILS env var"
                  : "Switch between Contractor and Worker"
              }
              className="transition-smooth ring-focus flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent"
            >
              <UserCog className="h-3.5 w-3.5 text-accent-600" />
              Change role
            </button>
            <button
              onClick={() => {
                onEditCredits();
                setOpen(false);
              }}
              className="transition-smooth ring-focus flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent-600" />
              Adjust credits
            </button>
            <button
              onClick={() => {
                onImpersonate();
                setOpen(false);
              }}
              disabled={user.role === "SUPER_ADMIN" || user.status === "SUSPENDED"}
              title={
                user.role === "SUPER_ADMIN"
                  ? "Cannot impersonate another super admin"
                  : user.status === "SUSPENDED"
                  ? "Reinstate the user before impersonating"
                  : "Shadow-login as this contractor"
              }
              className="transition-smooth ring-focus flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent"
            >
              <Eye className="h-3.5 w-3.5" />
              Impersonate
            </button>
            <div className="my-1 h-px bg-zinc-100" />
            {user.status === "ACTIVE" ? (
              <button
                onClick={() => {
                  onConfirmStatus("suspend");
                  setOpen(false);
                }}
                disabled={user.role === "SUPER_ADMIN"}
                className="transition-smooth ring-focus flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <UserMinus className="h-3.5 w-3.5" />
                Suspend account
              </button>
            ) : (
              <button
                onClick={() => {
                  onConfirmStatus("unsuspend");
                  setOpen(false);
                }}
                className="transition-smooth ring-focus flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-accent-700 hover:bg-accent-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Reinstate account
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CreditsDialog({
  user,
  onClose,
  onApplied,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onApplied: (u: AdminUserRow) => void;
}) {
  const [delta, setDelta] = useState<number>(5);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!user || delta === 0) return;
    startTransition(async () => {
      const res = await adjustCredits(user.id, delta, reason);
      const updated: AdminUserRow = {
        ...user,
        remaining: res.remaining,
        creditsBonus:
          delta > 0 ? user.creditsBonus + delta : user.creditsBonus,
        creditsUsed:
          delta < 0 ? user.creditsUsed + Math.max(0, -delta) : user.creditsUsed,
      };
      onApplied(updated);
      setReason("");
      setDelta(5);
    });
  }

  return (
    <Dialog open={!!user} onClose={onClose} title="Adjust credits">
      {user && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
            <div className="font-medium text-zinc-900">
              {user.company || user.contractorName || user.email}
            </div>
            <div className="text-xs text-zinc-500">{user.email}</div>
            <div className="mt-2 text-xs text-zinc-600">
              Currently <span className="font-semibold">{user.remaining}</span>{" "}
              of {user.creditsIncluded + user.creditsBonus} remaining ·{" "}
              {user.creditsUsed} used
            </div>
          </div>

          <label className="block">
            <span className="font-label text-[11px] text-zinc-500">
              Adjustment (positive = add bonus credits, negative = mark used)
            </span>
            <input
              type="number"
              value={delta}
              onChange={(e) => setDelta(parseInt(e.target.value, 10) || 0)}
              className="input num-input mt-1.5 h-11 text-base font-medium"
            />
          </label>

          <label className="block">
            <span className="font-label text-[11px] text-zinc-500">
              Reason (audit log)
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Comp for failed AI run on 1247 Maple Ridge"
              className="input mt-1.5 h-11"
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={pending || delta === 0}>
              {pending ? "Applying…" : `Apply ${delta > 0 ? "+" : ""}${delta} credits`}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function StatusConfirm({
  confirm,
  onClose,
  onApplied,
}: {
  confirm: { user: AdminUserRow; action: "suspend" | "unsuspend" } | null;
  onClose: () => void;
  onApplied: (u: AdminUserRow) => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!confirm) return;
    const next = confirm.action === "suspend" ? "SUSPENDED" : "ACTIVE";
    startTransition(async () => {
      await setUserStatus(confirm.user.id, next, reason || undefined);
      onApplied({ ...confirm.user, status: next });
      setReason("");
    });
  }

  const isSuspend = confirm?.action === "suspend";

  return (
    <Dialog
      open={!!confirm}
      onClose={onClose}
      title={isSuspend ? "Suspend contractor" : "Reinstate contractor"}
    >
      {confirm && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
            <div className="font-medium text-zinc-900">
              {confirm.user.company || confirm.user.email}
            </div>
            <div className="text-xs text-zinc-500">{confirm.user.email}</div>
          </div>

          <p className="text-sm text-zinc-600">
            {isSuspend
              ? "They'll be signed out on next request and unable to access the dashboard, send proposals, or run estimates. Existing portal links remain accessible to homeowners."
              : "They'll regain full access. Existing data and proposals are unaffected."}
          </p>

          <label className="block">
            <span className="font-label text-[11px] text-zinc-500">
              Reason (audit log)
            </span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isSuspend
                  ? "e.g. Repeated chargebacks"
                  : "e.g. Resolved billing issue"
              }
              className="input mt-1.5 h-11"
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={isSuspend ? "danger" : "primary"}
              size="sm"
              onClick={submit}
              disabled={pending}
            >
              {pending ? "Working…" : isSuspend ? "Suspend" : "Reinstate"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ImpersonateDialog({
  user,
  onClose,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!user) return;
    setError(null);
    startTransition(async () => {
      try {
        await startImpersonation(user.id, reason);
        router.push("/dashboard");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start session");
      }
    });
  }

  return (
    <Dialog open={!!user} onClose={onClose} title="Impersonate contractor">
      {user && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="text-amber-900">
                <div className="font-medium">
                  You'll see exactly what {user.contractorName || user.email}{" "}
                  sees.
                </div>
                <div className="mt-0.5 text-xs text-amber-800/80">
                  An amber banner will follow you on every page. Any action
                  you take is recorded as theirs. Auto-expires after 60
                  minutes; end manually any time.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
            <div className="font-medium text-zinc-900">
              {user.company || user.contractorName || user.email}
            </div>
            <div className="text-xs text-zinc-500">{user.email}</div>
          </div>

          <label className="block">
            <span className="font-label text-[11px] text-zinc-500">
              Reason (audit log)
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Debugging Stripe Connect on their account"
              autoFocus
              className="input mt-1.5 h-11"
            />
          </label>

          {error && (
            <div className="anim-enter-fade rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={pending}>
              <Eye className="h-3.5 w-3.5" />
              {pending ? "Starting…" : "Start session"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function RoleDialog({
  user,
  onClose,
  onApplied,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onApplied: (u: AdminUserRow) => void;
}) {
  const [role, setRole] = useState<"CONTRACTOR" | "WORKER">("CONTRACTOR");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Seed the selection from the user each time the dialog opens; reset when
  // it closes so reopening the same user re-reads their current role.
  const seed = user?.role === "WORKER" ? "WORKER" : "CONTRACTOR";
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (!user && seededFor !== null) setSeededFor(null);
  if (user && seededFor !== user.id) {
    setSeededFor(user.id);
    setRole(seed);
    setError(null);
  }

  function submit() {
    if (!user) return;
    setError(null);
    startTransition(async () => {
      try {
        await setUserRole(user.id, role);
        onApplied({ ...user, role });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change role");
      }
    });
  }

  const options: { id: "CONTRACTOR" | "WORKER"; label: string; hint: string }[] =
    [
      { id: "CONTRACTOR", label: "Contractor", hint: "Full owner account" },
      { id: "WORKER", label: "Worker", hint: "Crew member — redacted pricing" },
    ];

  return (
    <Dialog open={!!user} onClose={onClose} title="Change role">
      {user && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
            <div className="font-medium text-zinc-900">
              {user.company || user.contractorName || user.email}
            </div>
            <div className="text-xs text-zinc-500">{user.email}</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setRole(o.id)}
                className={cn(
                  "transition-smooth ring-focus rounded-lg border p-3 text-left",
                  role === o.id
                    ? "border-accent-500 bg-accent-50/60 ring-2 ring-accent-500/15"
                    : "border-zinc-200 hover:border-zinc-300",
                )}
              >
                <div className="text-sm font-medium text-zinc-900">{o.label}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{o.hint}</div>
              </button>
            ))}
          </div>

          <p className="text-xs text-zinc-400">
            Admin access is managed via the ADMIN_EMAILS env var, not here.
          </p>

          {error && (
            <div className="anim-enter-fade rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={pending || role === user.role}
            >
              {pending ? "Saving…" : "Save role"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function PlanDialog({
  user,
  onClose,
  onApplied,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
  onApplied: (u: AdminUserRow) => void;
}) {
  const [tier, setTier] = useState<UserTier>("free");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (!user && seededFor !== null) setSeededFor(null);
  if (user && seededFor !== user.id) {
    setSeededFor(user.id);
    setTier(user.tier);
    setError(null);
  }

  function submit() {
    if (!user) return;
    setError(null);
    startTransition(async () => {
      try {
        await setUserTier(user.id, tier);
        // Mirror the server's tier -> status/planId mapping for the
        // optimistic row so the badge updates without a refetch. Free
        // deletes the row server-side, so it becomes a null subscription.
        const mapped =
          tier === "pro"
            ? { subscriptionStatus: "ACTIVE" as const, planId: "pro_monthly" }
            : tier === "trial"
              ? { subscriptionStatus: "TRIALING" as const, planId: "pro_monthly" }
              : { subscriptionStatus: null, planId: null };
        onApplied({ ...user, tier, ...mapped });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change plan");
      }
    });
  }

  const options: { id: UserTier; label: string; hint: string }[] = [
    { id: "free", label: "Free", hint: "No subscription" },
    { id: "trial", label: "Trial", hint: "Trialing Pro" },
    { id: "pro", label: "Pro", hint: "Counts as paying" },
  ];

  return (
    <Dialog open={!!user} onClose={onClose} title="Change plan">
      {user && (
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
            <div className="font-medium text-zinc-900">
              {user.company || user.contractorName || user.email}
            </div>
            <div className="text-xs text-zinc-500">{user.email}</div>
          </div>

          {user.stripeLinked ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div className="text-amber-900">
                  This account has a live Stripe subscription. Change its plan
                  in Stripe — a manual override here would be overwritten by the
                  next billing webhook.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setTier(o.id)}
                    className={cn(
                      "transition-smooth ring-focus rounded-lg border p-3 text-left",
                      tier === o.id
                        ? "border-accent-500 bg-accent-50/60 ring-2 ring-accent-500/15"
                        : "border-zinc-200 hover:border-zinc-300",
                    )}
                  >
                    <div className="text-sm font-medium text-zinc-900">
                      {o.label}
                    </div>
                    <div className="mt-0.5 text-[11px] leading-tight text-zinc-500">
                      {o.hint}
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-400">
                This sets the billing label only — it doesn&apos;t change credits
                (use Adjust credits for that).
              </p>
            </>
          )}

          {error && (
            <div className="anim-enter-fade rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
              {user.stripeLinked ? "Close" : "Cancel"}
            </Button>
            {!user.stripeLinked && (
              <Button
                size="sm"
                onClick={submit}
                disabled={pending || tier === user.tier}
              >
                {pending ? "Saving…" : "Save plan"}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-zinc-900/30 backdrop-blur-sm" />
          <motion.div
            initial={reduce ? false : { scale: 0.95, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-elevated"
          >
            <button
              onClick={onClose}
              className="transition-smooth ring-focus absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <X className="h-4 w-4" />
            </button>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              {title}
            </h2>
            <div className="mt-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
