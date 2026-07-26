import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublic = createRouteMatcher([
  "/",
  "/demo(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/p/(.*)",
  // Portal audio summary — homeowners play it logged-out; the route is
  // token-gated + rate-limited internally like the portal page itself.
  "/api/p/(.*)",
  // Legal pages must be reachable logged-out — Google's OAuth app
  // verification crawls the privacy policy without a session.
  "/privacy(.*)",
  "/terms(.*)",
  "/api/webhooks/(.*)",
  "/api/cron/(.*)",
  // Analytics beacon — anonymous visitors must be able to POST pageviews.
  "/api/track(.*)",
  // Landing-page teaser scan — the acquisition hook is anonymous by
  // definition. Tightly rate-limited (edge class + 2/day/IP durable).
  "/api/teaser(.*)",
]);

// ---------------------------------------------------------------------
// Layer-1 abuse protection: in-memory per-IP rate limiting at the edge.
//
// Scope-honest: these Maps are per-isolate (reset on deploy/cold start,
// not shared across regions), so this layer is a cheap flood-dampener
// and ban hammer for single-IP abuse — NOT the durable quota system.
// Durable per-user/per-action quotas + spend caps live in lib/abuse/*
// (Postgres) and run inside the route handlers and server actions.
// For volumetric DDoS, enable Vercel WAF / Attack Challenge Mode —
// that runs in front of this code entirely.
//
// Anonymous-reachable surfaces get much stricter limits than the
// signed-in app, per class below.
// ---------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const strikes = new Map<string, Bucket>();
const bans = new Map<string, number>(); // ip → banned-until (epoch ms)

const BAN_AFTER_STRIKES = 3; // limit trips within STRIKE_WINDOW_MS …
const STRIKE_WINDOW_MS = 10 * 60_000;
const BAN_MS = 15 * 60_000; // … earn a 15-minute timeout.

/** Increment a fixed-window counter; returns the post-increment count. */
function hit(map: Map<string, Bucket>, key: string, windowMs: number): number {
  const now = Date.now();
  const b = map.get(key);
  if (!b || b.resetAt <= now) {
    // Opportunistic sweep so the maps can't grow unbounded in a hot isolate.
    if (map.size > 10_000) {
      for (const [k, v] of map) if (v.resetAt <= now) map.delete(k);
    }
    map.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  b.count += 1;
  return b.count;
}

/** Requests allowed per IP per minute, by route class. */
function limitFor(pathname: string): { limit: number; cls: string } {
  // Unauthenticated portal — homeowners click links here; bots probe here.
  // Includes the portal API (/api/p/[token]/audio): same anonymous
  // audience, same strict budget.
  if (pathname.startsWith("/p/") || pathname.startsWith("/api/p/")) {
    return { limit: 40, cls: "portal" };
  }
  // Signature/secret-gated machine endpoints. Stripe retries are modest;
  // anything hammering these is brute-forcing the secret.
  if (pathname.startsWith("/api/webhooks/")) return { limit: 120, cls: "webhook" };
  if (pathname.startsWith("/api/cron/")) return { limit: 30, cls: "cron" };
  // Analytics beacons: ~2-3/min per open tab (pageview + 25s heartbeat),
  // so 60/min absorbs many tabs while still capping floods.
  if (pathname.startsWith("/api/track")) return { limit: 60, cls: "track" };
  // Teaser scans spend real API money per call — tightest class here;
  // the durable 2/day/IP limit inside the route is the real gate.
  if (pathname.startsWith("/api/teaser")) return { limit: 5, cls: "teaser" };
  // Auth + marketing pages (Clerk adds its own bot detection on top).
  if (
    pathname === "/" ||
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/demo")
  ) {
    return { limit: 60, cls: "anon-page" };
  }
  // Signed-in app + API: generous — this only catches floods.
  if (pathname.startsWith("/api/")) return { limit: 240, cls: "api" };
  return { limit: 300, cls: "app" };
}

function tooMany(retryAfterSec: number): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: "Too many requests", retryAfterSec }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}

function edgeRateLimit(req: Request, pathname: string): NextResponse | null {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0]!.trim() : req.headers.get("x-real-ip");
  if (!ip) return null; // local dev / unknown — the durable layer still applies

  const now = Date.now();
  const bannedUntil = bans.get(ip);
  if (bannedUntil && bannedUntil > now) {
    return tooMany(Math.ceil((bannedUntil - now) / 1000));
  }
  if (bannedUntil) bans.delete(ip);

  // Short-window burst check across everything from this IP …
  const burst = hit(buckets, `${ip}|burst`, 10_000);
  // … plus the per-minute class limit.
  const { limit, cls } = limitFor(pathname);
  const perMin = hit(buckets, `${ip}|${cls}`, 60_000);

  if (burst > 80 || perMin > limit) {
    const strikeCount = hit(strikes, ip, STRIKE_WINDOW_MS);
    if (strikeCount >= BAN_AFTER_STRIKES) {
      bans.set(ip, now + BAN_MS);
      console.warn(`[edge-limit] banned ${ip} for ${BAN_MS / 60000}m (class=${cls})`);
      return tooMany(Math.ceil(BAN_MS / 1000));
    }
    return tooMany(burst > 80 ? 10 : 60);
  }
  return null;
}

export default clerkMiddleware(async (auth, req) => {
  const limited = edgeRateLimit(req, req.nextUrl.pathname);
  if (limited) return limited;

  // Referral first-touch: ?ref=<code> on any page drops a 30-day cookie
  // that account creation (app/actions/me.ts attributeReferral) redeems.
  // First touch wins — an existing cookie is never overwritten.
  let res: NextResponse | undefined;
  const ref = req.nextUrl.searchParams.get("ref");
  if (ref && /^[a-z0-9-]{4,32}$/i.test(ref) && !req.cookies.get("fencetrace_ref")) {
    res = NextResponse.next();
    res.cookies.set("fencetrace_ref", ref, {
      maxAge: 30 * 86400,
      path: "/",
      sameSite: "lax",
    });
  }

  if (isPublic(req)) return res;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn({ returnBackUrl: req.url });
  }
  return res;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
