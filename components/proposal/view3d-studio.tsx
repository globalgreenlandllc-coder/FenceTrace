"use client";

import {
  Camera,
  Lock,
  Rotate3d,
  Route,
  Star,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  INTERACTION_HINT,
  INTERACTION_LABEL,
  moveShot,
  removeShot,
  renameShot,
  setCover,
  setInteraction,
  type FenceInteraction,
  type FenceViewSet,
} from "@/lib/fence/viewpoints";

/**
 * View3DStudio — the contractor's control panel for the 3D that the
 * CLIENT receives.
 *
 * Builder-only; the client portal never renders this. It governs three
 * decisions the contractor is making when they send a proposal:
 *   1. which angles the client can see (the saved shot list),
 *   2. which one the proposal opens on (the cover),
 *   3. how much the client may move the camera themselves.
 *
 * Shots are captured from the live preview above ("Save this angle"),
 * so what the contractor is looking at IS what they ship — there is no
 * separate camera-editing mode to get out of sync with the render.
 */

const MODES: FenceInteraction[] = ["free", "guided", "locked"];

const MODE_ICON = {
  free: Rotate3d,
  guided: Route,
  locked: Lock,
} as const;

export function View3DStudio({
  viewSet,
  activeShotId,
  onChange,
  onActiveShotChange,
  onSuggest,
  className,
}: {
  viewSet: FenceViewSet;
  activeShotId: string | null;
  onChange: (next: FenceViewSet) => void;
  onActiveShotChange: (id: string) => void;
  /** Rebuild the shot list from the drawn geometry. */
  onSuggest: () => void;
  className?: string;
}) {
  const { shots, coverShotId, interaction } = viewSet;

  return (
    <div
      className={cn(
        "rounded-2xl border border-ink/10 bg-white p-3.5 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-[13px] font-semibold text-zinc-900">
            3D presentation
          </h4>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Spin the preview above, then save the angles you want the client
            to see.
          </p>
        </div>
        <button
          type="button"
          onClick={onSuggest}
          className="ring-focus inline-flex items-center gap-1.5 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold text-accent-800 transition-colors hover:bg-accent-100"
        >
          <Camera className="h-3 w-3" />
          Suggest angles
        </button>
      </div>

      {/* Shot list — order is the order the client steps through. */}
      <ul className="mt-3 space-y-1.5">
        {shots.map((s, i) => {
          const isCover = s.id === coverShotId;
          const isActive = s.id === activeShotId;
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2 py-1.5 transition-colors",
                isActive
                  ? "border-accent-300 bg-accent-50"
                  : "border-zinc-200 bg-white",
              )}
            >
              {/* Reorder. Two buttons beat drag-and-drop here: the list
                  is short and this works on a phone in a truck. */}
              <div className="flex flex-col leading-none">
                <button
                  type="button"
                  aria-label={`Move ${s.label} earlier`}
                  disabled={i === 0}
                  onClick={() => onChange(moveShot(viewSet, s.id, -1))}
                  className="ring-focus px-1 text-[9px] text-zinc-400 hover:text-zinc-800 disabled:opacity-25"
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label={`Move ${s.label} later`}
                  disabled={i === shots.length - 1}
                  onClick={() => onChange(moveShot(viewSet, s.id, 1))}
                  className="ring-focus px-1 text-[9px] text-zinc-400 hover:text-zinc-800 disabled:opacity-25"
                >
                  ▼
                </button>
              </div>

              <button
                type="button"
                onClick={() => onActiveShotChange(s.id)}
                className="ring-focus min-w-0 flex-1 text-left"
                title="Fly the preview to this angle"
              >
                <input
                  value={s.label}
                  onChange={(e) =>
                    onChange(renameShot(viewSet, s.id, e.target.value))
                  }
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Angle name"
                  maxLength={40}
                  className="ring-focus w-full truncate rounded bg-transparent text-[12px] font-medium text-zinc-900 outline-none focus:bg-white"
                />
                <span className="text-[10px] text-zinc-400">
                  {Math.round(s.view.yawDeg)}° ·{" "}
                  {s.view.squash >= 0.62
                    ? "top-down"
                    : s.view.squash <= 0.4
                      ? "eye level"
                      : "3/4 view"}
                  {s.zoom ? ` · ${s.zoom.k.toFixed(1)}× zoom` : ""}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onChange(setCover(viewSet, s.id))}
                aria-pressed={isCover}
                title={
                  isCover
                    ? "The client's proposal opens on this angle"
                    : "Open the client's proposal on this angle"
                }
                className={cn(
                  "ring-focus rounded-full p-1 transition-colors",
                  isCover
                    ? "text-amber-500"
                    : "text-zinc-300 hover:text-amber-400",
                )}
              >
                <Star className={cn("h-3.5 w-3.5", isCover && "fill-current")} />
              </button>
              <button
                type="button"
                onClick={() => onChange(removeShot(viewSet, s.id))}
                disabled={shots.length <= 1}
                aria-label={`Remove ${s.label}`}
                title={
                  shots.length <= 1
                    ? "A proposal needs at least one angle"
                    : "Remove this angle"
                }
                className="ring-focus rounded-full p-1 text-zinc-300 transition-colors hover:text-rose-500 disabled:opacity-30 disabled:hover:text-zinc-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>

      {/* The lock. */}
      <div className="mt-3 border-t border-zinc-100 pt-3">
        <div className="text-[11px] font-semibold text-zinc-700">
          What the client can do
        </div>
        <div className="mt-1.5 inline-flex w-full rounded-full border border-ink/10 bg-zinc-50 p-0.5 text-[11px] font-semibold">
          {MODES.map((m) => {
            const Icon = MODE_ICON[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange(setInteraction(viewSet, m))}
                aria-pressed={interaction === m}
                className={cn(
                  "ring-focus inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 transition-colors",
                  interaction === m
                    ? "bg-accent-600 text-white shadow-sm"
                    : "text-ink/55 hover:text-ink",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{INTERACTION_LABEL[m]}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          {INTERACTION_HINT[interaction]}
        </p>
      </div>
    </div>
  );
}
