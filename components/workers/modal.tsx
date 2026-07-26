"use client";

import { X } from "lucide-react";

/**
 * Shared modal chrome + labeled-field primitive for the workers surfaces
 * (invite, assign-job, schedule-from-proposal). One copy so backdrop,
 * animation, and close behavior can't drift between the dialogs.
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="anim-enter-fade absolute inset-0 bg-ink/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`surface anim-pop relative z-10 w-full ${maxWidth} rounded-2xl border border-zinc-200 bg-white shadow-elevated`}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="transition-smooth ring-focus rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="block space-y-1.5">
    <span className="font-label text-zinc-500">{label}</span>
    {children}
  </label>
);
