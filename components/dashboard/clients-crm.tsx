"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Loader2,
  Mail,
  MapPin,
  NotebookPen,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/dashboard/stat-tile";
import { cn, formatCurrency } from "@/lib/utils";
import { timeAgo } from "@/lib/dashboard-mock";
import {
  addClientNote,
  deleteClientNote,
  getClientNotes,
  getCrmClients,
  type CrmClient,
  type CrmNote,
} from "@/app/actions/crm";

const usd = (cents: number) => formatCurrency(Math.round(cents) / 100);

const STATUS_META: Record<
  CrmClient["latestStatus"],
  { label: string; tone: "accent" | "neutral" | "amber" | "rose" | "sky" | "violet" | "emerald" }
> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SENT: { label: "Sent", tone: "sky" },
  VIEWED: { label: "Viewed", tone: "amber" },
  ACCEPTED: { label: "Won", tone: "emerald" },
  DECLINED: { label: "Declined", tone: "rose" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

export function ClientsCrm() {
  const [clients, setClients] = useState<CrmClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    getCrmClients().then((rows) => {
      if (cancelled) return;
      setClients(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.email ?? "").toLowerCase().includes(needle) ||
        c.addresses.some((a) => a.toLowerCase().includes(needle)),
    );
  }, [clients, q]);

  const hot = clients.filter((c) => c.nextAction.urgency >= 4).length;
  const wonCents = clients.reduce((acc, c) => acc + c.wonCents, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          index={0}
          loading={loading}
          label="Clients"
          value={String(clients.length)}
          footnote="Everyone you've quoted"
        />
        <StatTile
          index={1}
          loading={loading}
          label="Need a touch"
          value={String(hot)}
          footnote="Follow-ups the CRM flagged"
          delta={hot > 0 ? { text: "act today", positive: false } : undefined}
        />
        <StatTile
          index={2}
          loading={loading}
          label="Won work"
          value={usd(wonCents)}
          footnote="Accepted contract value"
        />
        <StatTile
          index={3}
          loading={loading}
          label="Collected"
          value={usd(clients.reduce((acc, c) => acc + c.paidCents, 0))}
          footnote="Across all clients"
        />
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, or address…"
          className="input h-11 w-full pl-10 text-sm"
        />
      </div>

      <div className="space-y-3">
        {loading && (
          <>
            <div className="skeleton h-20 w-full rounded-2xl" />
            <div className="skeleton h-20 w-full rounded-2xl" />
            <div className="skeleton h-20 w-full rounded-2xl" />
          </>
        )}
        {filtered.map((c, i) => (
          <ClientRow key={c.key} client={c} index={i} />
        ))}
        {!loading && filtered.length === 0 && (
          <div className="anim-enter rounded-2xl border border-dashed border-zinc-300 bg-white p-16 text-center">
            <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
              <Users className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-zinc-900">
              {q ? "No clients match" : "No clients yet"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {q
                ? "Try a different search."
                : "Send your first proposal and the client lands here automatically."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClientRow({ client, index }: { client: CrmClient; index: number }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[client.latestStatus];
  const na = client.nextAction;

  return (
    <div
      className={cn(
        "anim-enter rounded-2xl border border-zinc-200/70 bg-white shadow-card transition-smooth hover:shadow-elevated",
        index < 8 && `stagger-${Math.min(index + 1, 8)}`,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ring-focus flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3.5 text-left sm:px-5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-50 text-sm font-semibold text-accent-700">
          {client.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-900">
              {client.name}
            </span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {client.noteCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                <NotebookPen className="h-3 w-3" />
                {client.noteCount}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-zinc-400">
            {client.addresses[0] ?? client.email ?? "—"}
            {client.proposalCount > 1 && ` · ${client.proposalCount} proposals`}
            {" · "}
            {timeAgo(client.lastActivityAt)}
          </span>
        </span>
        <span className="hidden text-right sm:block">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Quoted
          </span>
          <span className="block text-sm font-medium tabular-nums text-zinc-900">
            {usd(client.quotedCents)}
          </span>
        </span>
        <span className="hidden text-right sm:block">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Paid
          </span>
          <span className="block text-sm font-medium tabular-nums text-zinc-900">
            {usd(client.paidCents)}
          </span>
        </span>
        <Badge tone={na.tone}>{na.label}</Badge>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-400 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && <ClientDetail client={client} />}
    </div>
  );
}

function ClientDetail({ client }: { client: CrmClient }) {
  const na = client.nextAction;
  return (
    <div className="anim-enter-fade space-y-4 border-t border-zinc-100 px-4 py-4 sm:px-5">
      {/* Smart suggestion */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm",
          na.tone === "rose"
            ? "border-rose-200 bg-rose-50/60 text-rose-900"
            : na.tone === "amber"
              ? "border-amber-200 bg-amber-50/60 text-amber-900"
              : na.tone === "emerald"
                ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
                : "border-accent-200 bg-accent-50/60 text-accent-900",
        )}
      >
        <span className="font-semibold">{na.label}.</span>
        <span className="min-w-0 flex-1 text-[13px] opacity-80">{na.detail}</span>
        <span className="flex gap-2">
          {client.email && (
            <a
              href={`mailto:${client.email}`}
              className="ring-focus inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/70 px-2.5 text-xs font-medium transition-smooth hover:bg-white"
            >
              <Mail className="h-3.5 w-3.5" /> Email
            </a>
          )}
          <Link
            href="/dashboard/proposals/new"
            className="ring-focus inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white/70 px-2.5 text-xs font-medium transition-smooth hover:bg-white"
          >
            <Plus className="h-3.5 w-3.5" /> New proposal
          </Link>
        </span>
      </div>

      {/* Deal history */}
      <div>
        <div className="microlabel">Deal history</div>
        <div className="mt-2 space-y-1.5">
          {client.proposals.map((p) => {
            const meta = STATUS_META[p.status];
            return (
              <Link
                key={p.id}
                href={`/proposal?id=${p.id}`}
                className="ring-focus group flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm transition-smooth hover:border-accent-300 hover:bg-accent-50/30"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-300 group-hover:text-accent-500" />
                <span className="min-w-0 flex-1 truncate text-zinc-700">
                  {p.address || "No address"}
                </span>
                <span className="text-xs text-zinc-400">{timeAgo(p.updatedAt)}</span>
                <span className="font-medium tabular-nums text-zinc-900">
                  {usd(p.totalCents)}
                </span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </Link>
            );
          })}
        </div>
      </div>

      <NotesSection clientKey={client.key} />
    </div>
  );
}

function NotesSection({ clientKey }: { clientKey: string }) {
  const [notes, setNotes] = useState<CrmNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getClientNotes(clientKey).then((rows) => {
      if (!cancelled) setNotes(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [clientKey]);

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    const r = await addClientNote(clientKey, draft);
    if (r.ok) {
      setDraft("");
      setNotes(await getClientNotes(clientKey));
    }
    setBusy(false);
  }
  async function remove(id: string) {
    setBusy(true);
    await deleteClientNote(id);
    setNotes(await getClientNotes(clientKey));
    setBusy(false);
  }

  return (
    <div>
      <div className="microlabel">Notes</div>
      <div className="mt-2 space-y-1.5">
        {notes === null && <div className="skeleton h-8 w-full rounded-lg" />}
        {notes?.map((n) => (
          <div
            key={n.id}
            className="group flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50/40 px-3 py-2 text-sm"
          >
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-700">
              {n.body}
            </p>
            <span className="shrink-0 text-[11px] text-zinc-400">
              {timeAgo(n.createdAt)}
            </span>
            <button
              type="button"
              onClick={() => remove(n.id)}
              disabled={busy}
              className="ring-focus rounded-md p-0.5 text-zinc-300 opacity-0 transition-smooth hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
              title="Delete note"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {notes?.length === 0 && (
          <p className="text-xs text-zinc-400">
            No notes yet — gate codes, dog's name, "call after 5pm"…
          </p>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a note…"
          className="input h-9 min-w-0 flex-1 text-sm"
        />
        <Button size="sm" variant="outline" onClick={add} disabled={busy || !draft.trim()}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </Button>
      </div>
    </div>
  );
}
