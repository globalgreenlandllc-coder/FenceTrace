"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Download,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ProposalTopBar({
  address,
  preview,
  proposalId,
  onTogglePreview,
  onSend,
  onDownload,
  onSave,
  saving,
  saved,
  onDelete,
  deleting,
}: {
  address: string;
  preview: boolean;
  /** Hides the delete option when the proposal hasn't been persisted yet. */
  proposalId?: string | null;
  onTogglePreview: () => void;
  onSend: () => void;
  onDownload: () => void;
  /** Persist the draft without sending. Omit to hide the Save button. */
  onSave?: () => void;
  saving?: boolean;
  saved?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white print:hidden">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4">
        <Link
          href="/dashboard"
          className="ring-focus flex items-center gap-2 rounded-md text-sm text-zinc-500 transition-smooth hover:text-zinc-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>
        <div className="hidden h-6 w-px bg-zinc-200 md:block" />
        <div className="hidden md:block">
          <Logo showSubtitle={false} />
        </div>
        <div className="hidden h-6 w-px bg-zinc-200 md:block" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-900">
              Proposal · {address}
            </span>
            <Badge tone={preview ? "accent" : "neutral"}>
              {preview ? "Client preview" : "Draft"}
            </Badge>
          </div>
        </div>

        {/* Builder / Preview tabs — both are always clickable so you can
            jump back to editing from preview with one tap. Bigger hit
            targets + clearer "active" styling than the previous version. */}
        <div className="flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1">
          <button
            type="button"
            onClick={() => preview && onTogglePreview()}
            aria-pressed={!preview}
            className={cn(
              "ring-focus flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-smooth",
              !preview
                ? "bg-zinc-900 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
            )}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => !preview && onTogglePreview()}
            aria-pressed={preview}
            className={cn(
              "ring-focus flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-smooth",
              preview
                ? "bg-accent-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
            )}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </button>
        </div>

        {onSave && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onSave}
            disabled={saving}
            title="Save draft — edits also auto-save"
          >
            <span
              key={saving ? "saving" : saved ? "saved" : "idle"}
              className="anim-enter-fade inline-flex"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
            </span>
            <span className="hidden sm:inline">
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </span>
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={onDownload}
          className="hidden lg:inline-flex"
        >
          <Download className="h-4 w-4" />
          PDF
        </Button>
        <Button size="sm" onClick={onSend}>
          <Send className="h-4 w-4" />
          Send
        </Button>

        {proposalId && onDelete && (
          <OverflowMenu onDelete={onDelete} deleting={deleting} />
        )}
      </div>
    </header>
  );
}

/**
 * Overflow menu — currently just a Delete option, but the dropdown
 * shape leaves room for Duplicate / Archive / Export later without
 * having to rearrange the top-bar layout.
 */
function OverflowMenu({
  onDelete,
  deleting,
}: {
  onDelete: () => void;
  deleting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        className="ring-focus active:scale-[0.98] inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-smooth hover:bg-zinc-50 hover:text-zinc-900"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="anim-pop origin-top-right absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-elevated">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="ring-focus anim-enter-fade flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-rose-700 transition-smooth hover:bg-rose-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete proposal
            </button>
          ) : (
            <div className="anim-enter-fade p-3">
              <div className="text-sm font-medium text-zinc-900">
                Delete this proposal?
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                This permanently removes the draft and any view history. You
                can&apos;t undo this.
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setOpen(false);
                  }}
                  className="ring-focus rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-smooth hover:bg-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => onDelete()}
                  className="ring-focus active:scale-[0.98] inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-smooth hover:bg-rose-700 disabled:opacity-60"
                >
                  {deleting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
