import { NextResponse } from "next/server";
import { consumeLimit, requestIp } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";
import { fenceScanCore } from "@/lib/fence/scan-core";
import { teaserPayloadFromScan } from "@/lib/fence/teaser";

// The anonymous landing-page acquisition hook: runs the REAL fence
// measuring engine (lib/fence/scan-core.ts — geocode → satellite tile →
// Regrid parcel → suggested runs) and returns the redacted preview:
// the visitor's actual photo + actual parcel-line runs, counts only —
// footage stays behind the free signup. Both limits below are
// fail-closed; every scan spends real Google + Regrid money.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Platform-wide daily ceiling — bounds the worst-case Google/Regrid
  // spend of a distributed bot sweep. The per-IP pass above already
  // spent a durable-limit read.
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

  try {
    const scan = await fenceScanCore(address);
    if (!scan.ok) {
      // Bad address / imagery gap — a user problem, not a signup wall.
      return NextResponse.json(
        { ok: false, reason: scan.reason },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { ok: true, teaser: teaserPayloadFromScan(scan) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[teaser] scan threw", e);
    return NextResponse.json(
      { ok: false, reason: "The scan hit a snag — try again in a minute." },
      { status: 500 },
    );
  }
}
