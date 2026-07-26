"use client";

import { useState } from "react";

/**
 * Inline "type the price you want" field. Renders `$` + a numeric input
 * sized to its content. While focused it holds the raw keystrokes in a
 * local draft so the field can be cleared / retyped freely; on every
 * valid number it calls `onCommit` (so totals update live), and on blur
 * it snaps back to the canonical computed total. The parent owns the
 * real value — this component never stores a price, only the in-progress
 * draft. Pair it with `markupPctForTarget` so the typed sticker price is
 * turned back into the package markup that produces it.
 */
export function EditablePrice({
  total,
  onCommit,
  className,
}: {
  total: number;
  onCommit: (target: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? Math.round(total).toLocaleString("en-US");

  return (
    <span className="inline-flex items-baseline">
      <span className={className}>$</span>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        aria-label="Set total price"
        onFocus={(e) => {
          setDraft(String(Math.round(total)));
          e.currentTarget.select();
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, "");
          setDraft(raw);
          const n = parseFloat(raw);
          if (Number.isFinite(n) && n > 0) onCommit(n);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`${className ?? ""} border-b border-dashed border-zinc-300 bg-transparent tabular-nums outline-none transition-smooth focus:border-accent-600`}
        style={{ width: `${Math.max(display.length, 2)}ch` }}
      />
    </span>
  );
}
