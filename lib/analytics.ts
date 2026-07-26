// First-party web analytics — shared derivation helpers.
//
// Used by the ingest endpoint (app/api/track/route.ts) and the admin
// queries (app/actions/analytics.ts). Everything here is deterministic
// string mapping — no I/O — so both sides classify traffic identically.

/** "Online now" = a session heartbeat within this window. The client
 *  heartbeats every 25s while the tab is visible, so 60s tolerates two
 *  dropped beacons before someone reads as offline. */
export const LIVE_WINDOW_MS = 60_000;

/** How far back the live activity feed looks. Wider than the "online now"
 *  window so the feed still has content between clicks (a quiet minute
 *  shouldn't blank it), but recent enough to read as "happening now". */
export const LIVE_ACTIVITY_WINDOW_MS = 5 * 60_000;

/** Client rolls a new session after this much inactivity (industry-standard 30m). */
export const SESSION_IDLE_MS = 30 * 60_000;

export type Segment = "marketing" | "app" | "portal" | "admin";

export type Channel =
  | "direct"
  | "organic"
  | "paid"
  | "social"
  | "email"
  | "referral";

export const CHANNEL_LABELS: Record<Channel, string> = {
  direct: "Direct",
  organic: "Organic search",
  paid: "Paid ads",
  social: "Social",
  email: "Email",
  referral: "Referral",
};

/* ------------------------------------------------------------------ */
/*  Custom events + intent (the "smart" live activity layer)           */
/* ------------------------------------------------------------------ */

/** Named custom events the client may fire via trackEvent(). Bounded so a
 *  forged beacon can't invent arbitrary event names. */
export const KNOWN_EVENTS = new Set([
  "subscribe_click", // clicked "Upgrade to Pro" (Stripe checkout start)
  "checkout_start", // reserved for future checkout surfaces
  "credit_topup_click", // clicked a credit pack
]);

/** How much buying intent an activity item shows. `subscribe` is the loud
 *  one — the green alert. `purchase` is a credit top-up (real revenue, but
 *  NOT a subscription attempt, so it never inflates the subscribe count).
 *  Ordered by strength for sorting/rollups. */
export type Intent = "subscribe" | "purchase" | "signup" | "trial" | "normal";

export const INTENT_RANK: Record<Intent, number> = {
  subscribe: 4,
  purchase: 3,
  signup: 2,
  trial: 1,
  normal: 0,
};

/** Classify a live activity item (a pageview or a custom event) by buying
 *  intent. Explicit subscribe/checkout events are the strongest signal;
 *  otherwise the destination path is the tell. This is what lets the feed
 *  flag "trying to subscribe" without a human reading every row. */
export function classifyIntent(
  path: string,
  eventName?: string | null,
): Intent {
  if (eventName === "subscribe_click" || eventName === "checkout_start") {
    return "subscribe";
  }
  // A credit top-up is revenue but NOT a subscription attempt — its own tier
  // so it never gets counted/badged as "trying to subscribe".
  if (eventName === "credit_topup_click") return "purchase";
  if (path.startsWith("/sign-up")) return "signup";
  if (
    path.startsWith("/estimate") ||
    path.startsWith("/demo") ||
    path.startsWith("/dashboard/proposals/new")
  ) {
    return "trial";
  }
  return "normal";
}

/** Human label for a path in the activity feed ("/dashboard/settings" →
 *  "Billing & settings"). Falls back to the raw path for anything unmapped. */
export function friendlyPath(path: string): string {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  const exact: Record<string, string> = {
    "/": "Landing page",
    "/sign-up": "Sign-up",
    "/sign-in": "Sign-in",
    "/demo": "Demo",
    "/demo/satellite": "Satellite demo",
    "/demo/blueprint": "Blueprint demo",
    "/estimate": "Address takeoff",
    "/dashboard": "Dashboard",
    "/dashboard/settings": "Billing & settings",
    "/dashboard/proposals/new": "New proposal",
    "/dashboard/blueprints": "Blueprints",
    "/dashboard/blueprints/new": "New blueprint",
    "/dashboard/clients": "Clients",
    "/pricing": "Pricing",
    "/privacy": "Privacy",
    "/terms": "Terms",
  };
  if (exact[clean]) return exact[clean];
  if (clean.startsWith("/p/")) return "Proposal (homeowner)";
  if (clean.startsWith("/dashboard/blueprints/")) return "Blueprint";
  if (clean.startsWith("/dashboard/proposals/")) return "Proposal";
  if (clean.startsWith("/worker")) return "Worker portal";
  if (clean.startsWith("/admin")) return "Admin";
  return clean;
}

/** Label for a custom event name in the feed. */
export function eventLabel(name: string): string {
  switch (name) {
    case "subscribe_click":
    case "checkout_start":
      return "Started checkout — trying to subscribe";
    case "credit_topup_click":
      return "Buying credits";
    default:
      return name.replace(/_/g, " ");
  }
}

/** Which product area a path belongs to. `marketing` = the public
 *  acquisition surface (landing, demo, sign-in/up, legal); `portal` =
 *  homeowners opening a proposal link (the contractor's customers, not
 *  prospects); `app` = signed-in product use; `admin` = us. */
export function segmentForPath(path: string): Segment {
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/p/")) return "portal";
  if (
    path.startsWith("/dashboard") ||
    path.startsWith("/estimate") ||
    path.startsWith("/proposal") ||
    path.startsWith("/worker")
  ) {
    return "app";
  }
  return "marketing";
}

const SEARCH_HOSTS = [
  "google.",
  "bing.",
  "duckduckgo.",
  "search.yahoo.",
  "search.brave.",
  "ecosia.",
  "startpage.",
  "yandex.",
  "baidu.",
];

const SOCIAL_HOSTS = [
  "facebook.",
  "fb.com",
  "instagram.",
  "l.instagram.",
  "twitter.",
  "t.co",
  "x.com",
  "linkedin.",
  "lnkd.in",
  "tiktok.",
  "youtube.",
  "youtu.be",
  "reddit.",
  "nextdoor.",
  "pinterest.",
  "threads.",
];

const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "paid",
  "cpm",
  "cpv",
  "display",
  "paidsocial",
  "paid_social",
  "retargeting",
]);

function hostMatches(host: string, needles: string[]): boolean {
  return needles.some((n) => host === n || host.includes(n));
}

export function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** First-touch acquisition channel for a session. Click-ids (gclid/fbclid)
 *  and paid utm_mediums win over the referrer so tagged ad traffic is
 *  never misfiled as organic/social. */
export function deriveChannel(input: {
  referrerHost: string | null;
  ownHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  hasClickId: boolean;
}): Channel {
  const medium = input.utmMedium?.toLowerCase() ?? "";
  if (input.hasClickId || PAID_MEDIUMS.has(medium)) return "paid";
  if (medium === "email" || input.utmSource?.toLowerCase() === "email") {
    return "email";
  }
  if (medium === "social" || medium === "organic_social") return "social";

  const ref = input.referrerHost;
  // Same-site referrers mean an in-site navigation started the session
  // (e.g. after a hard reload) — that's direct, not a referral.
  if (!ref || (input.ownHost && ref === input.ownHost)) {
    return input.utmSource ? "referral" : "direct";
  }
  if (hostMatches(ref, SEARCH_HOSTS)) return "organic";
  if (hostMatches(ref, SOCIAL_HOSTS)) return "social";
  return "referral";
}

const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|prerender|preview|scrape|python-requests|python-urllib|curl\/|wget\/|axios\/|node-fetch|go-http-client|facebookexternalhit|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|twitterbot|bingpreview|vercel-screenshot|checkly|pingdom|uptimerobot|datadog|newrelic|gtmetrix|pagespeed/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return true; // real browsers always send a UA
  return BOT_UA.test(ua);
}

export function parseDevice(ua: string): "desktop" | "mobile" | "tablet" {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "mobile";
  return "desktop";
}

export function parseBrowser(ua: string): string {
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/chrome\/|crios\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return "Other";
}

export function parseOs(ua: string): string {
  if (/windows/i.test(ua)) return "Windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/android/i.test(ua)) return "Android";
  if (/linux/i.test(ua)) return "Linux";
  return "Other";
}

/** Client-generated ids (crypto.randomUUID with dashes stripped, or
 *  a random fallback) — bounded charset + length so a forged beacon
 *  can't stuff junk into the primary key. */
export function isValidTrackingId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

export function clamp(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  return v.length > max ? v.slice(0, max) : v;
}
