"use client";

import { useState } from "react";
import { Loader2, Database, CheckCircle2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type SyncResult = {
  success: true;
  added: number;
  updated: number;
  cities: { city: string; added: number; updated: number; fetched: number }[];
};

export function SyncLeadsButton() {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; result: SyncResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const trigger = async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/admin/sync-leads-now", {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) {
        setState({
          kind: "error",
          message: body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      setState({ kind: "done", result: body as SyncResult });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "network error",
      });
    }
  };

  return (
    <div className="surface p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
          <Database className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-zinc-900">
              Lead sync
            </span>
            {state.kind === "done" && (
              <Badge tone="emerald" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Synced
              </Badge>
            )}
            {state.kind === "error" && (
              <Badge tone="rose" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Failed
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Pulls fresh permits from every enabled city feed. Runs nightly
            via cron — click here to backfill or force a refresh now.
          </p>

          {state.kind === "loading" && (
            <p className="anim-enter-fade mt-2 inline-flex items-center gap-1.5 text-xs text-zinc-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              Syncing — usually 60–90s on a cold prod DB…
            </p>
          )}

          {state.kind === "done" && (
            <div className="anim-enter-fade mt-2 space-y-1">
              <p className="text-xs text-zinc-700">
                <span className="font-semibold tabular-nums">
                  +{state.result.added}
                </span>{" "}
                added ·{" "}
                <span className="font-semibold tabular-nums">
                  {state.result.updated}
                </span>{" "}
                updated across {state.result.cities.length} cities
              </p>
              <details className="text-xs text-zinc-500">
                <summary className="transition-smooth ring-focus cursor-pointer rounded-md hover:text-zinc-700">
                  Per-city breakdown
                </summary>
                <ul className="mt-1.5 space-y-0.5 pl-2">
                  {state.result.cities.map((c) => (
                    <li key={c.city} className="tabular-nums">
                      {c.city}: fetched {c.fetched}, added {c.added}, updated{" "}
                      {c.updated}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          {state.kind === "error" && (
            <p className="anim-enter-fade mt-2 break-words text-xs text-rose-700">
              {state.message}
            </p>
          )}

          <button
            onClick={trigger}
            disabled={state.kind === "loading"}
            className="transition-smooth press-scale ring-focus mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-600 px-3 text-xs font-medium text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.kind === "loading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Syncing…
              </>
            ) : state.kind === "done" ? (
              "Sync again"
            ) : (
              "Sync leads now"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
