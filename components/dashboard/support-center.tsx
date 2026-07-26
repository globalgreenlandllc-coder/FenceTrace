"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Send, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createSupportTicket,
  replyToMyTicket,
  getMyTickets,
  type UserTicket,
} from "@/app/actions/support";

const STATUS: Record<UserTicket["status"], { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-accent-50 text-accent-700" },
  PENDING: { label: "Replied", cls: "bg-amber-50 text-amber-700" },
  RESOLVED: { label: "Resolved", cls: "bg-emerald-50 text-emerald-700" },
};

export function SupportCenter({ initial }: { initial: UserTicket[] }) {
  const [tickets, setTickets] = useState(initial);
  const [composing, setComposing] = useState(initial.length === 0);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busy, startBusy] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setTickets(await getMyTickets());
  }

  function submitNew() {
    setErr(null);
    startBusy(async () => {
      const r = await createSupportTicket({ subject, message });
      if (!r.ok) return setErr(r.reason);
      setSubject("");
      setMessage("");
      setComposing(false);
      await refresh();
    });
  }

  function submitReply(id: string) {
    if (!replyBody.trim()) return;
    setErr(null);
    startBusy(async () => {
      const r = await replyToMyTicket({ id, body: replyBody });
      if (!r.ok) return setErr(r.reason);
      setReplyBody("");
      setReplyFor(null);
      await refresh();
    });
  }

  return (
    <div className="space-y-5">
      {!composing && (
        <button
          type="button"
          onClick={() => setComposing(true)}
          className="ring-focus inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-700"
        >
          <Plus className="h-4 w-4" /> New request
        </button>
      )}

      {composing && (
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <LifeBuoy className="h-4 w-4 text-accent-600" /> How can we help?
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="ring-focus w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-accent-500"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Describe what you need — a question, a bug, a billing issue…"
            className="ring-focus w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-accent-500"
          />
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitNew}
              disabled={busy || !subject.trim() || !message.trim()}
              className="ring-focus inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send request
            </button>
            {tickets.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setComposing(false);
                  setErr(null);
                }}
                className="ring-focus rounded-lg px-3 py-2 text-sm text-zinc-500 transition-smooth hover:text-zinc-700"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {tickets.map((t) => (
          <div key={t.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-zinc-900">{t.subject}</h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  STATUS[t.status].cls,
                )}
              >
                {STATUS[t.status].label}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {t.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.fromAdmin ? "justify-start" : "justify-end")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
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

            {t.status !== "RESOLVED" &&
              (replyFor === t.id ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={2}
                    placeholder="Reply…"
                    className="ring-focus w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-accent-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => submitReply(t.id)}
                      disabled={busy || !replyBody.trim()}
                      className="ring-focus inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white transition-smooth hover:bg-accent-700 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyFor(null);
                        setReplyBody("");
                      }}
                      className="ring-focus rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition-smooth hover:text-zinc-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setReplyFor(t.id)}
                  className="ring-focus mt-3 text-sm font-medium text-accent-700 transition-smooth hover:text-accent-800"
                >
                  Reply
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
