"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cookie } from "lucide-react";

/**
 * One-time cookie/privacy notice. FenceScan sets only essential cookies
 * (sign-in, security) and keeps an anonymous first-party analytics id in
 * localStorage — no ad trackers, so this is a NOTICE with a single
 * acknowledgement, not a consent wall with toggles. Verifier-friendly:
 * the disclosure is visible on first visit and links the policy's
 * cookie section.
 *
 * Renders nothing until mounted (localStorage is client-only), and never
 * again once acknowledged.
 */

const ACK_KEY = "fencescan.cookieNoticeAck";

export function CookieNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(ACK_KEY) !== "1") setShow(true);
    } catch {
      // storage unavailable (private mode) — show it; dismissal just
      // won't persist across visits, which is the honest fallback.
      setShow(true);
    }
  }, []);

  if (!show) return null;

  function ack() {
    setShow(false);
    try {
      localStorage.setItem(ACK_KEY, "1");
    } catch {
      // nothing to do — the banner stays dismissed for this page life
    }
  }

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="anim-enter fixed bottom-4 left-4 right-4 z-[70] mx-auto max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-elevated sm:left-4 sm:right-auto sm:mx-0"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700">
          <Cookie className="h-4 w-4" />
        </div>
        <div className="min-w-0 text-[13px] leading-relaxed text-zinc-600">
          FenceScan uses <strong className="text-zinc-800">essential cookies</strong>{" "}
          for sign-in and security, plus anonymous first-party analytics. No ad
          trackers, no selling data.{" "}
          <Link
            href="/privacy#cookies"
            className="ring-focus rounded-sm font-medium text-accent-700 underline hover:text-accent-800"
          >
            Learn more
          </Link>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={ack}
          className="ring-focus press-scale transition-smooth rounded-lg bg-zinc-900 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-zinc-800"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
