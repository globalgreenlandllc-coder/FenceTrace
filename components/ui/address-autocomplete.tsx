"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { suggestAddresses } from "@/app/actions/address-suggest";

/**
 * Address autocomplete — Google Places suggestions as you type.
 *
 * `usePlacesSuggestions` is the shared debounced fetcher (used by the
 * start page's combobox to blend live suggestions with recents);
 * `AddressAutocompleteInput` is a drop-in input + dropdown for plain
 * address fields (the estimator's scan bar). Results come from the
 * Places API via a server action, so no key ships to the browser and
 * failures degrade to "no dropdown", never a broken input.
 */

const genToken = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function usePlacesSuggestions(
  query: string,
  fetcher?: (q: string) => Promise<string[]>,
) {
  const [places, setPlaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const token = useRef<string>(genToken());
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 5) {
      seq.current++;
      setPlaces([]);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      let next: string[] = [];
      try {
        if (fetcherRef.current) {
          next = await fetcherRef.current(q);
        } else {
          const res = await suggestAddresses({
            query: q,
            sessionToken: token.current,
          });
          next = res.ok ? res.suggestions : [];
        }
      } catch {
        next = [];
      }
      if (seq.current !== id) return; // a newer keystroke superseded us
      setPlaces(next);
      setLoading(false);
    }, 280);
    return () => window.clearTimeout(t);
  }, [query]);

  return { places, loading };
}

/** Tiny required attribution when Places results show without a map. */
export function PlacesAttribution() {
  return (
    <div className="px-3.5 pb-1.5 pt-1 text-right text-[9px] font-medium tracking-wide text-zinc-300">
      powered by Google
    </div>
  );
}

export function AddressAutocompleteInput({
  value,
  onChange,
  onPick,
  placeholder,
  autoFocus,
  className,
  inputClassName,
  fetcher,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Called when the user picks a suggestion (click or Enter). */
  onPick: (address: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
  /** Test/demo override for the suggestion source. */
  fetcher?: (q: string) => Promise<string[]>;
}) {
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const blurTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { places } = usePlacesSuggestions(value, fetcher);

  const open = focused && places.length > 0;

  useEffect(() => {
    setHighlight(-1);
  }, [value]);

  // An SSR'd autoFocus input is focused by the BROWSER before React
  // hydrates — onFocus never fires, and the dropdown would never open
  // for a user who just starts typing. Adopt pre-hydration focus.
  useEffect(() => {
    if (document.activeElement === inputRef.current) setFocused(true);
  }, []);

  return (
    <div className={cn("relative", className)}>
      <MapPin className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          // typing IS focus — belt-and-suspenders for the case above
          if (!focused) setFocused(true);
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (blurTimer.current) {
            window.clearTimeout(blurTimer.current);
            blurTimer.current = null;
          }
          setFocused(true);
        }}
        onBlur={() => {
          // Defer so a mousedown on a dropdown row runs before the
          // dropdown unmounts — the standard combobox pattern.
          blurTimer.current = window.setTimeout(() => {
            setFocused(false);
            setHighlight(-1);
          }, 120);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1 >= places.length ? 0 : h + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h <= 0 ? places.length - 1 : h - 1));
          } else if (e.key === "Enter" && highlight >= 0 && places[highlight]) {
            e.preventDefault();
            onPick(places[highlight]);
            setFocused(false);
          } else if (e.key === "Escape") {
            setHighlight(-1);
            setFocused(false);
          }
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        className={cn(
          "ring-focus h-12 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:border-accent-400",
          inputClassName,
        )}
      />
      {open && (
        <ul
          role="listbox"
          className="anim-pop absolute left-0 right-0 top-full z-30 mt-2 origin-top overflow-hidden rounded-xl border border-zinc-200/80 bg-white py-1.5 shadow-elevated"
        >
          {places.map((s, i) => (
            <li key={s} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                // mousedown fires before input blur — pick before unmount
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(s);
                  setFocused(false);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "transition-smooth flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm",
                  i === highlight
                    ? "bg-accent-50 text-accent-900"
                    : "text-zinc-700 hover:bg-zinc-50",
                )}
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <span className="truncate">{s}</span>
              </button>
            </li>
          ))}
          <PlacesAttribution />
        </ul>
      )}
    </div>
  );
}
