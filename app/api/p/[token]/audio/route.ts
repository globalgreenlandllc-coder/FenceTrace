import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  generateProposalAudio,
  isAudioFresh,
  presignPlayUrl,
  scriptFor,
} from "@/lib/proposal-audio";
import { checkPortalWrite } from "@/lib/abuse/guards";
import { POLICIES } from "@/lib/abuse/policies";
import { requestIp } from "@/lib/abuse/rate-limit";

// Spoken summary of the proposal for the client portal's "Listen"
// button. Normally warmed at send time (warmProposalAudio in
// sendProposal) so the client's first tap plays instantly; this route
// still generates on demand to cover proposals sent before that existed,
// a warm-up that failed or timed out, and price changes after sending —
// the cache is keyed by a hash of the script text, so a negotiated
// discount flips the hash and the next play regenerates with the new
// numbers. Replays are a DB read + JSON response; only cache misses
// spend TTS money, so only they are rate-limited.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length < 3) {
    return NextResponse.json(
      { ok: false, reason: "Proposal not found" },
      { status: 404 },
    );
  }

  const row = await db.proposal.findUnique({ where: { publicToken: token } });
  if (!row) {
    return NextResponse.json(
      { ok: false, reason: "Proposal not found" },
      { status: 404 },
    );
  }

  let script: string;
  let hash: string;
  try {
    ({ script, hash } = scriptFor(row));
  } catch (e) {
    console.error("[proposal-audio] script build failed", e);
    return NextResponse.json(
      { ok: false, reason: "This proposal can't be summarized as audio." },
      { status: 422 },
    );
  }

  // Cache hit: the stored audio was generated from this exact script.
  // The store is private, so the raw blob URL is useless to the browser
  // — mint a short-lived signed GET URL for this play.
  if (isAudioFresh(row, hash)) {
    const playUrl = await presignPlayUrl(row.audioUrl!);
    if (playUrl) {
      await logListened(row.id, request, true);
      return NextResponse.json({ ok: true, url: playUrl });
    }
    // Signing failed (missing token / deleted blob) — fall through and
    // regenerate rather than dead-ending the play button.
  }

  // Cache miss — about to spend real TTS money on an unauthenticated
  // route, so per-token + per-IP limits apply here and only here.
  const guard = await checkPortalWrite(
    POLICIES.portalAudio,
    token,
    "proposalAudio",
  );
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, reason: guard.reason },
      { status: 429, headers: { "Retry-After": String(guard.retryAfterSec) } },
    );
  }

  const blobUrl = await generateProposalAudio(row, script, hash);
  const playUrl = blobUrl ? await presignPlayUrl(blobUrl) : null;
  if (!playUrl) {
    return NextResponse.json(
      {
        ok: false,
        reason:
          "Couldn't prepare the audio right now — please try again in a minute.",
      },
      { status: 502 },
    );
  }
  await logListened(row.id, request, false);
  return NextResponse.json({ ok: true, url: playUrl });
}

/** Best-effort LISTENED event — analytics must never fail the play. */
async function logListened(
  proposalId: string,
  request: Request,
  cached: boolean,
): Promise<void> {
  try {
    await db.proposalEvent.create({
      data: {
        proposalId,
        kind: "LISTENED",
        ipAddress: requestIp(request),
        userAgent: request.headers.get("user-agent"),
        payload: { cached } as Prisma.InputJsonValue,
      },
    });
  } catch {
    // ignore
  }
}
