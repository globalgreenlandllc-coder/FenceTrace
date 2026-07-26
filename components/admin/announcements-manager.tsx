"use client";

import { useState, useTransition } from "react";
import { Loader2, Mail, Plus, Sparkles, Trash2, Send, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  saveAnnouncement,
  deleteAnnouncement,
  broadcastAnnouncementEmail,
  polishAnnouncementCopy,
  type AdminAnnouncement,
} from "@/app/actions/announcements";

type Level = AdminAnnouncement["level"];
type Audience = AdminAnnouncement["audience"];

const LEVELS: { id: Level; label: string; dot: string }[] = [
  { id: "INFO", label: "Update", dot: "bg-accent-500" },
  { id: "SUCCESS", label: "Good news", dot: "bg-emerald-500" },
  { id: "WARNING", label: "Heads up", dot: "bg-amber-500" },
  { id: "CRITICAL", label: "Important", dot: "bg-rose-500" },
];
const AUDIENCES: { id: Audience; label: string }[] = [
  { id: "ALL", label: "Everyone" },
  { id: "CONTRACTORS", label: "Contractors" },
  { id: "WORKERS", label: "Crew" },
];

type Draft = {
  id?: string;
  title: string;
  body: string;
  level: Level;
  audience: Audience;
};

const EMPTY: Draft = { title: "", body: "", level: "INFO", audience: "ALL" };

export function AnnouncementsManager({
  initial,
}: {
  initial: AdminAnnouncement[];
}) {
  const [list, setList] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [busy, startBusy] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function refresh() {
    const { listAnnouncements } = await import("@/app/actions/announcements");
    const r = await listAnnouncements();
    if (r.ok) setList(r.announcements);
  }

  function save(publish?: boolean) {
    if (!draft) return;
    setErr(null);
    startBusy(async () => {
      const r = await saveAnnouncement({ ...draft, publish });
      if (!r.ok) return setErr(r.reason);
      setDraft(null);
      setAiPrompt("");
      await refresh();
      setFlash(publish ? "Published" : "Saved");
      setTimeout(() => setFlash(null), 2500);
    });
  }

  function runAi() {
    if (!draft || !aiPrompt.trim()) return;
    setErr(null);
    setAiBusy(true);
    void (async () => {
      const r = await polishAnnouncementCopy({
        prompt: aiPrompt,
        level: draft.level,
        audience: draft.audience,
      });
      setAiBusy(false);
      if (!r.ok) return setErr(r.reason);
      setDraft((d) => (d ? { ...d, title: r.title, body: r.body } : d));
    })();
  }

  function togglePublish(a: AdminAnnouncement) {
    setErr(null);
    startBusy(async () => {
      const r = await saveAnnouncement({
        id: a.id,
        title: a.title,
        body: a.body,
        level: a.level,
        audience: a.audience,
        publish: !a.publishedAt,
      });
      if (!r.ok) return setErr(r.reason);
      await refresh();
    });
  }

  function email(a: AdminAnnouncement) {
    if (!confirm(`Email "${a.title}" to all ${a.audience === "ALL" ? "" : a.audience.toLowerCase() + " "}accounts?`))
      return;
    setErr(null);
    startBusy(async () => {
      const r = await broadcastAnnouncementEmail(a.id);
      if (!r.ok) return setErr(r.reason);
      await refresh();
      setFlash(`Emailed ${r.sent}${r.failed ? ` (${r.failed} failed)` : ""}`);
      setTimeout(() => setFlash(null), 3500);
    });
  }

  function remove(a: AdminAnnouncement) {
    if (!confirm(`Delete "${a.title}"? This can't be undone.`)) return;
    startBusy(async () => {
      await deleteAnnouncement(a.id);
      await refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        {!draft && (
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY })}
            className="ring-focus inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-700"
          >
            <Plus className="h-4 w-4" /> New announcement
          </button>
        )}
        {flash && (
          <span className="text-sm font-medium text-emerald-700">{flash}</span>
        )}
      </div>

      {draft && (
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          {/* AI draft */}
          <div className="rounded-xl border border-accent-200 bg-accent-50/50 p-3">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-accent-800">
              <Sparkles className="h-3.5 w-3.5" /> Draft with AI
            </label>
            <div className="flex gap-2">
              <input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. new per-item AI pricing is live; how to use it"
                className="ring-focus min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500"
                onKeyDown={(e) => e.key === "Enter" && runAi()}
              />
              <button
                type="button"
                onClick={runAi}
                disabled={aiBusy || !aiPrompt.trim()}
                className="ring-focus inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-700 disabled:opacity-50"
              >
                {aiBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Write
              </button>
            </div>
          </div>

          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title"
            className="ring-focus w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base font-semibold outline-none focus:border-accent-500"
          />
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="What do you want your users to know?"
            rows={5}
            className="ring-focus w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500"
          />

          <div className="flex flex-wrap items-center gap-4">
            <Segment
              label="Level"
              options={LEVELS.map((l) => ({ id: l.id, label: l.label }))}
              value={draft.level}
              onChange={(v) => setDraft({ ...draft, level: v as Level })}
            />
            <Segment
              label="Audience"
              options={AUDIENCES}
              value={draft.audience}
              onChange={(v) => setDraft({ ...draft, audience: v as Audience })}
            />
          </div>

          {err && <p className="text-sm text-rose-600">{err}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => save(true)}
              disabled={busy}
              className="ring-focus inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-semibold text-white transition-smooth hover:bg-accent-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Publish
            </button>
            <button
              type="button"
              onClick={() => save(false)}
              disabled={busy}
              className="ring-focus rounded-lg border border-zinc-200 px-3.5 py-2 text-sm font-semibold text-zinc-700 transition-smooth hover:bg-zinc-50"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setErr(null);
              }}
              className="ring-focus rounded-lg px-3 py-2 text-sm text-zinc-500 transition-smooth hover:text-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {list.length === 0 && !draft && (
          <p className="rounded-xl border border-dashed border-zinc-200 py-10 text-center text-sm text-zinc-400">
            No announcements yet.
          </p>
        )}
        {list.map((a) => {
          const lv = LEVELS.find((l) => l.id === a.level)!;
          return (
            <div
              key={a.id}
              className="flex flex-wrap items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3.5"
            >
              <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", lv.dot)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold text-zinc-900">{a.title}</h3>
                  {a.publishedAt ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Live
                    </span>
                  ) : (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                      Draft
                    </span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm text-zinc-600">
                  {a.body}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
                  <span>{AUDIENCES.find((x) => x.id === a.audience)?.label}</span>
                  <span>· {lv.label}</span>
                  {a.dismissedCount > 0 && <span>· {a.dismissedCount} dismissed</span>}
                  {a.emailedAt && <span>· emailed {a.emailCount}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconBtn
                  title={a.publishedAt ? "Unpublish" : "Publish"}
                  onClick={() => togglePublish(a)}
                  disabled={busy}
                >
                  <Send className={cn("h-4 w-4", a.publishedAt ? "text-emerald-600" : "text-zinc-400")} />
                </IconBtn>
                <IconBtn title="Email to audience" onClick={() => email(a)} disabled={busy || !a.publishedAt}>
                  <Mail className="h-4 w-4 text-zinc-500" />
                </IconBtn>
                <IconBtn
                  title="Edit"
                  onClick={() =>
                    setDraft({
                      id: a.id,
                      title: a.title,
                      body: a.body,
                      level: a.level,
                      audience: a.audience,
                    })
                  }
                  disabled={busy}
                >
                  <Pencil className="h-4 w-4 text-zinc-500" />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => remove(a)} disabled={busy}>
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </IconBtn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Segment({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div className="inline-flex gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "ring-focus rounded-md px-2.5 py-1 text-xs font-semibold transition-smooth",
              value === o.id
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="ring-focus inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white transition-smooth hover:bg-zinc-50 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
