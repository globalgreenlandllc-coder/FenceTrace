import { NextResponse } from "next/server";
import { consumeLimit, requestIp } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";

// TODO(fence): the anonymous landing-page teaser used to run the real
// satellite roof engine and return the trace geometry. The engine was removed
// in the FenceTrace demolition phase — the route now always answers 503 with
// a launch-teaser message. Rate limiting is kept so the endpoint stays cheap
// to hammer; the fence engine will restore the real scan here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LAUNCHING_REASON =
  "Fence scans are launching soon — create a free account to be first in line.";

export async function POST(request: Request) {
  let address = "";
  try {
    const body = (await request.json()) as { address?: unknown };
    address = String(body?.address ?? "").trim();
  } catch {
    // fall through to the length check
  }
  if (address.length < 8 || address.length > 200) {
    return NextResponse.json(
      { ok: false, reason: "Enter a full street address, like 6220 97th Dr NE, Lake Stevens, WA." },
      { status: 400 },
    );
  }

  const ip = requestIp(request);
  const byIp = await consumeLimit({
    policy: POLICIES.teaserScan,
    // Local dev / missing proxy headers share one bucket — fine, the
    // global cap is the real backstop.
    key: ip ? `ip:${ip}` : "ip:unknown",
    context: { ip: ip ?? undefined, route: "/api/teaser" },
  });
  if (!byIp.ok) {
    return NextResponse.json(
      { ok: false, reason: byIp.reason, signup: true },
      { status: 429, headers: { "Retry-After": String(byIp.retryAfterSec) } },
    );
  }

  // Platform-wide backstop even while stubbed — the per-IP pass above
  // already spent a durable-limit read, and when the engine lands this
  // cap is what protects the API budget.
  const global = await consumeLimit({
    policy: POLICIES.teaserGlobal,
    key: "global",
    context: { route: "/api/teaser" },
  });
  if (!global.ok) {
    return NextResponse.json(
      { ok: false, reason: global.reason, signup: true },
      { status: 429, headers: { "Retry-After": String(global.retryAfterSec) } },
    );
  }

  // TODO(fence): run the fence measuring engine here and return the redacted
  // trace. Until then: honest 503 — signup:true so the widget renders the
  // create-account link the copy promises.
  return NextResponse.json(
    { ok: false, reason: LAUNCHING_REASON, signup: true },
    { status: 503 },
  );
}
