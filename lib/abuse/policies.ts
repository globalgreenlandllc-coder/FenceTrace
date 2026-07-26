// Central abuse-protection policy table. Every limit in the app is
// declared here (not inline at call sites) so thresholds can be read,
// compared, and tuned in one place. Each policy is env-overridable
// without a deploy-time code change: ABUSE_LIMIT_<NAME> takes
// "count/windowSec[,count/windowSec...]" (e.g. "10/3600,30/86400").
//
// failMode decides what happens when the limiter itself errors (DB
// blip): "open" lets the request through (availability wins — cheap
// endpoints), "closed" blocks it (cost safety wins — anything that
// spends real money on LLMs / external APIs).

export type LimitRule = { limit: number; windowSec: number };

export type Policy = {
  /** Stable key — also the bucket-key prefix and the AbuseEvent.policy value. */
  name: string;
  rules: LimitRule[];
  failMode: "open" | "closed";
  /** Human-readable denial reason surfaced to the caller. */
  message: string;
};

const HOUR = 3600;
const DAY = 86400;

function envRules(envName: string, fallback: LimitRule[]): LimitRule[] {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const parsed: LimitRule[] = [];
  for (const part of raw.split(",")) {
    const [limit, windowSec] = part.split("/").map((n) => parseInt(n, 10));
    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(windowSec) && windowSec > 0) {
      parsed.push({ limit, windowSec });
    }
  }
  return parsed.length > 0 ? parsed : fallback;
}

function make(
  name: string,
  env: string,
  fallback: LimitRule[],
  failMode: "open" | "closed",
  message: string,
): Policy {
  return { name, rules: envRules(env, fallback), failMode, message };
}

export const POLICIES = {
  /** Satellite AI estimate — the credit-metered pipeline (Solar + SAM-2 + GPT-4o). */
  estimateRun: make(
    "estimate.run",
    "ABUSE_LIMIT_ESTIMATE_RUN",
    [
      { limit: 10, windowSec: HOUR },
      { limit: 30, windowSec: DAY },
    ],
    "closed",
    "You've hit the hourly estimate limit — please try again in a bit.",
  ),

  /** Blueprint analyze / re-analyze — the most expensive action in the app (3× Opus + ensemble). */
  blueprintAnalyze: make(
    "blueprint.analyze",
    "ABUSE_LIMIT_BLUEPRINT_ANALYZE",
    [
      { limit: 4, windowSec: HOUR },
      { limit: 12, windowSec: DAY },
    ],
    "closed",
    "Blueprint analysis limit reached — you can run a few per hour. Try again shortly.",
  ),

  /** Blob presign / upload-token minting. Cheap-ish but grants storage capability. */
  blueprintUpload: make(
    "blueprint.upload",
    "ABUSE_LIMIT_BLUEPRINT_UPLOAD",
    [
      { limit: 20, windowSec: HOUR },
      { limit: 60, windowSec: DAY },
    ],
    "open",
    "Too many uploads — please wait a few minutes.",
  ),

  /** Leads map query — heavy multi-query Prisma reads, fired on map pans. */
  leadsQuery: make(
    "leads.query",
    "ABUSE_LIMIT_LEADS_QUERY",
    [{ limit: 120, windowSec: 60 }],
    "open",
    "Too many map queries — slow down a little.",
  ),

  /** Contractor-initiated email sends (proposals, reminders, receipts, invites) — per user. */
  emailUser: make(
    "email.user",
    "ABUSE_LIMIT_EMAIL_USER",
    [
      { limit: 20, windowSec: HOUR },
      { limit: 100, windowSec: DAY },
    ],
    "closed",
    "Email limit reached for now — try again in an hour.",
  ),

  /** Chokepoint inside sendEmailViaResend: every email to one recipient address. */
  emailRecipient: make(
    "email.recipient",
    "ABUSE_LIMIT_EMAIL_RECIPIENT",
    [{ limit: 20, windowSec: DAY }],
    "open",
    "This recipient has received too many emails today.",
  ),

  /** Chokepoint inside sendEmailViaResend: all emails platform-wide. */
  emailGlobal: make(
    "email.global",
    "ABUSE_LIMIT_EMAIL_GLOBAL",
    [{ limit: 500, windowSec: DAY }],
    "open",
    "Platform email volume cap reached — sending is paused until tomorrow.",
  ),

  /** Unauthenticated portal writes (/p/[token] accept) — per proposal token. */
  portalAccept: make(
    "portal.accept",
    "ABUSE_LIMIT_PORTAL_ACCEPT",
    [{ limit: 5, windowSec: DAY }],
    "open",
    "Too many attempts on this proposal — please try again tomorrow or contact your contractor.",
  ),

  /** Unauthenticated portal writes (/p/[token] change-order respond) — per proposal token. */
  portalChangeOrder: make(
    "portal.changeorder",
    "ABUSE_LIMIT_PORTAL_CHANGEORDER",
    [{ limit: 10, windowSec: DAY }],
    "open",
    "Too many attempts on this change order — please try again later.",
  ),

  /** Unauthenticated portal writes (/p/[token] price-request + counter) — per proposal token.
   *  A real negotiation is a handful of moves; this only ever bites a loop. */
  portalDiscount: make(
    "portal.discount",
    "ABUSE_LIMIT_PORTAL_DISCOUNT",
    [{ limit: 20, windowSec: DAY }],
    "open",
    "Too many price-request updates on this proposal — please try again later or contact your contractor.",
  ),

  /** Audio-summary TTS generation (/api/p/[token]/audio cache misses) —
   *  per proposal token. Replays hit the cached blob and never consume
   *  this; a regeneration only happens when the proposal content
   *  changes, so a handful per day covers any real negotiation. Closed:
   *  every miss spends real OpenAI money. */
  portalAudio: make(
    "portal.audio",
    "ABUSE_LIMIT_PORTAL_AUDIO",
    [{ limit: 8, windowSec: DAY }],
    "closed",
    "The audio summary is taking a break — please read the proposal, or try again tomorrow.",
  ),

  /** Anonymous landing-page teaser scans — per IP. Each one runs the
   *  real satellite engine (Google Solar + imagery ≈ tens of cents),
   *  so the budget is tight: the wow only needs one. Closed. */
  teaserScan: make(
    "teaser.scan",
    "ABUSE_LIMIT_TEASER_SCAN",
    [{ limit: 2, windowSec: DAY }],
    "closed",
    "That's the free-preview limit for today — create a free account for unlimited scans.",
  ),

  /** Whole-platform daily ceiling on anonymous teaser scans — bounds
   *  the worst-case spend of a distributed bot sweep. Closed. */
  teaserGlobal: make(
    "teaser.global",
    "ABUSE_LIMIT_TEASER_GLOBAL",
    [{ limit: 150, windowSec: DAY }],
    "closed",
    "The free preview is very popular right now — create a free account to scan any address.",
  ),

  /** All unauthenticated portal writes from one IP, across tokens. */
  portalIp: make(
    "portal.ip",
    "ABUSE_LIMIT_PORTAL_IP",
    [{ limit: 30, windowSec: HOUR }],
    "open",
    "Too many requests — please try again later.",
  ),

  /** Admin alert emails — at most one per alert kind per window (dedupe, not protection). */
  alertThrottle: make(
    "alert.throttle",
    "ABUSE_LIMIT_ALERT_THROTTLE",
    [{ limit: 1, windowSec: HOUR }],
    "open",
    "alert already sent this window",
  ),
} as const;

// ---------------------------------------------------------------------
// Spend caps (cents). These are HARD ceilings on estimated AI/external-
// API cost, enforced by lib/abuse/spend-guard.ts on top of the request-
// count limits above. Conservative defaults for a single-tenant-per-
// user contractor SaaS — raise via env as real usage grows.
// ---------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const SPEND_CAPS = {
  /** Per-user estimated AI spend per day. */
  userDailyCents: () => envInt("ABUSE_USER_DAILY_AI_CENTS", 2_000), // $20
  /** Whole-platform estimated AI spend per hour — crossing it opens the circuit. */
  globalHourlyCents: () => envInt("ABUSE_GLOBAL_HOURLY_AI_CENTS", 3_000), // $30
  /** Whole-platform estimated AI spend per day — crossing it opens the circuit. */
  globalDailyCents: () => envInt("ABUSE_GLOBAL_DAILY_AI_CENTS", 10_000), // $100
};

/**
 * Flat per-action cost estimates (cents) used for the pre-flight spend
 * check, before actual token usage is known. Deliberately on the high
 * side — the ledger is corrected with token-derived actuals where the
 * pipeline captures usage.
 */
export const EST_COST_CENTS = {
  SATELLITE_ESTIMATE: envInt("ABUSE_EST_COST_SATELLITE", 25),
  BLUEPRINT_ANALYSIS: envInt("ABUSE_EST_COST_BLUEPRINT", 150),
  LEAD_SYNC: envInt("ABUSE_EST_COST_LEAD_SYNC", 50),
} as const;
