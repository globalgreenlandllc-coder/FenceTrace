"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  resetPromptTemplate,
  upsertPromptTemplate,
  type PromptRow,
} from "@/app/actions/prompts";

const GROUPS: { category: PromptRow["category"]; title: string; blurb: string }[] =
  [
    {
      category: "address",
      title: "Scan by address",
      blurb:
        "Drives the satellite-image estimate (enter an address → AI traces the fence).",
    },
    {
      category: "blueprint",
      title: "Scan from uploaded plans",
      blurb:
        "Drives the PDF-plan estimate (upload construction plans → AI measures the fence).",
    },
    {
      category: "proposal",
      title: "Proposal builder",
      blurb:
        "Drives the AI helpers inside the proposal editor (the location-based recommended price).",
    },
  ];

export function PromptsEditor({ rows }: { rows: PromptRow[] }) {
  return (
    <div className="space-y-8">
      {GROUPS.map((g) => {
        const groupRows = rows.filter((r) => r.category === g.category);
        if (groupRows.length === 0) return null;
        return (
          <section key={g.category}>
            <div className="mb-3">
              <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                {g.title}
              </h2>
              <p className="text-sm text-zinc-500">{g.blurb}</p>
            </div>
            <div className="space-y-4">
              {groupRows.map((row) => (
                <PromptCard key={row.key} row={row} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PromptCard({ row }: { row: PromptRow }) {
  const [draft, setDraft] = useState(row.content);
  // Baseline = last value persisted to the DB. Starts at the server value.
  const [saved, setSaved] = useState(row.content);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"save" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = draft !== saved;
  const customized = useMemo(
    () => row.isModified || dirty,
    [row.isModified, dirty],
  );

  function save() {
    if (!draft.trim()) {
      setError("Prompt can't be empty.");
      return;
    }
    setError(null);
    setAction("save");
    startTransition(async () => {
      try {
        await upsertPromptTemplate({ key: row.key, content: draft });
        setSaved(draft);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        setAction(null);
      }
    });
  }

  function reset() {
    if (
      !confirm(
        `Reset "${row.label}" to the version that ships with the app? This replaces the current prompt.`,
      )
    ) {
      return;
    }
    setError(null);
    setAction("reset");
    startTransition(async () => {
      try {
        const res = await resetPromptTemplate(row.key);
        setDraft(res.content);
        setSaved(res.content);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Reset failed");
      } finally {
        setAction(null);
      }
    });
  }

  return (
    <div className="surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-zinc-900">{row.label}</h3>
            <Badge tone="neutral" className="gap-1">
              <Sparkles className="h-3 w-3" />
              {row.model}
            </Badge>
            {customized && <Badge tone="amber">Customized</Badge>}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            {row.description}
          </p>
        </div>
        {row.updatedAt && (
          <div className="text-right text-[11px] text-zinc-400">
            Updated {new Date(row.updatedAt).toLocaleString()}
          </div>
        )}
      </div>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={14}
        className="transition-smooth mt-4 w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-[13px] leading-relaxed text-zinc-800 outline-none focus:border-accent-500 focus:bg-white focus:ring-2 focus:ring-accent-500/15"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className={cn(
            "transition-smooth press-scale ring-focus inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium shadow-sm disabled:opacity-50",
            "bg-accent-600 text-white hover:bg-accent-700",
          )}
        >
          {pending && action === "save" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : justSaved && !dirty ? (
            <Check className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {pending && action === "save"
            ? "Saving…"
            : justSaved && !dirty
              ? "Saved"
              : "Save"}
        </button>

        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="transition-smooth press-scale ring-focus inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-800 shadow-sm hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
        >
          {pending && action === "reset" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          Reset to default
        </button>

        {dirty && (
          <span className="anim-enter-fade text-xs text-amber-700">Unsaved changes</span>
        )}
        {error && (
          <span className="anim-enter-fade inline-flex items-center gap-1 text-xs text-rose-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
