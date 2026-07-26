"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Sparkles, CheckCircle2, Circle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  adminReplyToTicket,
  setTicketStatus,
  suggestSupportReply,
  listSupportTickets,
  type AdminTicket,
} from "@/app/actions/support";

const STATUS_STYLE: Record<AdminTicket["status"], { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-accent-50 text-accent-700" },
  PENDING: { label: "Awaiting reply", cls: "bg-amber-50 text-amber-700" },
  RESOLVED: { label: "Resolved", cls: "bg-emerald-50 text-emerald-700" },
};

export function SupportInbox({ initial }: { initial: AdminTicket[] }) {
  const [tickets, setTickets] = useState(initial);
  const [selId, setSelId] = useState<string | null>(initial[0]?.id ?? null);
  const [reply, setReply] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const selected = useMemo(
    () => tickets.find((t) => t.id === selId) ?? null,
    [tickets, selId],
  );
  const openCount = tickets.filter((t) => t.status !== "RESOLVED").length;

  async function refresh(keep?: string) {
    const next = await listSupportTickets();
    setTickets(next);
    if (keep && next.some((t) => t.id === keep)) setSelId(keep);
  }

  function send(resolve?: boolean) {
    if (!selected || !reply.trim()) return;
    setErr(null);
    startBusy(async () => {
      const r = await adminReplyToTicket({ id: selected.id, body: reply, resolve });
      if (!r.ok) return setErr(r.reason);
      setReply("");
      await refresh(selected.id);
    });
  }

  function toggleResolved(t: AdminTicket) {
    startBusy(async () => {
      await setTicketStatus({
        id: t.id,
        status: t.status === "RESOLVED" ? "OPEN" : "RESOLVED",
      });
      await refresh(t.id);
    });
  }

  function draftAi() {
    if (!selected) return;
    setErr(null);
    setAiBusy(true);
    void suggestSupportReply(selected.id).then((r) => {
      setAiBusy(false);
      if (!r.ok) return setErr(r.reason);
      setReply(r.reply);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      {/* List */}
      <div className="space-y-2">
        <div className="px-1 text-xs font-medium text-zinc-400">
          {openCount} open · {tickets.length} total
        </div>
        {tickets.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-200 py-10 text-center text-sm text-zinc-400">
            No tickets yet.
          </p>
        )}
        {tickets.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelId(t.id)}
            className={cn(
              "ring-focus w-full rounded-xl border p-3 text-left transition-smooth",
              selId === t.id
                ? "border-accent-300 bg-accent-50/40"
                : "border-zinc-200 bg-white hover:bg-zinc-50",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-zinc-900">
                {t.subject}
              </span>
              {t.lastFromAdmin ? null : (
                <span className="h-2 w-2 shrink-0 rounded-full bg-accent-500" />
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-semibold",
                  STATUS_STYLE[t.status].cls,
                )}
              >
                {STATUS_STYLE[t.status].label}
              </span>
              {t.category && <span>· {t.category}</span>}
            </div>
            <div className="mt-1 truncate text-xs text-zinc-400">
              {t.requesterName}
            </div>
          </button>
        ))}
      </div>

      {/* Thread */}
      <div className="rounded-2xl border border-zinc-200 bg-white">
        {!selected ? (
          <div className="grid h-full place-items-center py-24 text-sm text-zinc-400">
            Select a ticket
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 p-4">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-zinc-900">
                  {selected.subject}
                </h2>
                <p className="text-xs text-zinc-500">
                  {selected.requesterName} · {selected.requesterEmail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleResolved(selected)}
                disabled={busy}
                className="ring-focus inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition-smooth hover:bg-zinc-50"
              >
                {selected.status === "RESOLVED" ? (
                  <>
                    <Circle className="h-3.5 w-3.5" /> Reopen
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Mark resolved
                  </>
                )}
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {selected.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.fromAdmin ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                      m.fromAdmin
                        ? "bg-accent-600 text-white"
                        : "bg-zinc-100 text-zinc-800",
                    )}
                  >
                    {m.body}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-zinc-100 p-4">
              {err && <p className="text-sm text-rose-600">{err}</p>}
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                placeholder="Write a reply…"
                className="ring-focus w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-accent-500"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => send(false)}
                  disabled={busy || !reply.trim()}
                  className="ring-focus inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-700 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => send(true)}
                  disabled={busy || !reply.trim()}
                  className="ring-focus rounded-lg border border-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-700 transition-smooth hover:bg-zinc-50 disabled:opacity-50"
                >
                  Send &amp; resolve
                </button>
                <button
                  type="button"
                  onClick={draftAi}
                  disabled={aiBusy}
                  className="ring-focus ml-auto inline-flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50/60 px-3 py-2 text-sm font-semibold text-accent-700 transition-smooth hover:bg-accent-50 disabled:opacity-50"
                >
                  {aiBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Draft with AI
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
