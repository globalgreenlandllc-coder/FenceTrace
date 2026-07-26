"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/* ------------------------------------------------------------------ */
/*  First-party analytics tracker — mounted once in app/layout.tsx.    */
/*                                                                     */
/*  Sends beacons to /api/track:                                       */
/*   - a pageview on every App Router path change                      */
/*   - a heartbeat every 25s while the tab is visible (powers the      */
/*     "online now" strip in /admin/analytics)                         */
/*                                                                     */
/*  Identity is anonymous and first-party only: a persistent visitor   */
/*  id + a session id that rolls after 30 min of inactivity, both in   */
/*  localStorage (shared across tabs, so one reader = one session).    */
/*  The server links sessions to signed-in users via Clerk cookies —   */
/*  nothing identifying is stored client-side.                         */
/* ------------------------------------------------------------------ */

const VID_KEY = "gs_vid";
const SID_KEY = "gs_sid";
const SID_SEEN_KEY = "gs_sid_t";
const SESSION_IDLE_MS = 30 * 60_000; // keep in sync with lib/analytics.ts
const HEARTBEAT_MS = 25_000;

function randomId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** localStorage can throw (Safari private mode, storage quotas) — an
 *  in-memory fallback keeps the tracker working for the page's lifetime. */
const memory = new Map<string, string>();
function storeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
function storeSet(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // memory fallback already holds it
  }
}

function visitorId(): string {
  let vid = storeGet(VID_KEY);
  if (!vid || !/^[A-Za-z0-9_-]{8,64}$/.test(vid)) {
    vid = randomId();
    storeSet(VID_KEY, vid);
  }
  return vid;
}

/** Current session id, rolling a fresh one after 30 min of inactivity.
 *  Every call refreshes the last-seen stamp. */
function sessionId(): string {
  const now = Date.now();
  const seen = Number(storeGet(SID_SEEN_KEY) ?? 0);
  let sid = storeGet(SID_KEY);
  if (!sid || !/^[A-Za-z0-9_-]{8,64}$/.test(sid) || now - seen > SESSION_IDLE_MS) {
    sid = randomId();
    storeSet(SID_KEY, sid);
  }
  storeSet(SID_SEEN_KEY, String(now));
  return sid;
}

function send(payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([json], { type: "application/json" }));
      return;
    }
  } catch {
    // fall through to fetch
  }
  fetch("/api/track", {
    method: "POST",
    body: json,
    headers: { "Content-Type": "application/json" },
    keepalive: true,
  }).catch(() => {});
}

/** Fire a named high-intent event (e.g. a subscribe click) from anywhere in
 *  the client. Reuses the same anonymous session/visitor ids as pageviews,
 *  so the admin live feed can attribute it. Fire-and-forget; safe on the
 *  server (no-ops) and if the beacon fails. Names must be in KNOWN_EVENTS
 *  (lib/analytics.ts) or the server drops them. */
export function trackEvent(name: string, path?: string) {
  if (typeof window === "undefined") return;
  try {
    send({
      type: "event",
      name,
      sid: sessionId(),
      vid: visitorId(),
      path: path ?? window.location.pathname,
    });
  } catch {
    // analytics must never break a user action
  }
}

function utmFromLocation(): {
  utm: Record<string, string> | undefined;
  click: boolean;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    for (const key of ["source", "medium", "campaign", "term", "content"]) {
      const v = params.get(`utm_${key}`);
      if (v) utm[key] = v.slice(0, 200);
    }
    const click = ["gclid", "fbclid", "msclkid", "ttclid"].some((k) =>
      params.has(k),
    );
    return { utm: Object.keys(utm).length ? utm : undefined, click };
  } catch {
    return { utm: undefined, click: false };
  }
}

export function Tracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  // Pageview on every path change (and initial load).
  useEffect(() => {
    if (!pathname || lastTracked.current === pathname) return;
    lastTracked.current = pathname;
    const { utm, click } = utmFromLocation();
    send({
      type: "pageview",
      sid: sessionId(),
      vid: visitorId(),
      path: pathname,
      ref: document.referrer ? document.referrer.slice(0, 500) : undefined,
      utm,
      click,
    });
  }, [pathname]);

  // Presence heartbeat while the tab is visible.
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      send({
        type: "heartbeat",
        sid: sessionId(),
        vid: visitorId(),
        path: window.location.pathname,
      });
    };
    const interval = window.setInterval(beat, HEARTBEAT_MS);
    // A returning tab counts as present immediately, not 25s later.
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
