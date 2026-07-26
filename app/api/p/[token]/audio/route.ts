import { NextResponse } from "next/server";
import { put, del, issueSignedToken, presignUrl } from "@vercel/blob";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getActiveApiKey } from "@/lib/api-keys";
import {
  buildProposalAudioScript,
  audioScriptHash,
} from "@/lib/proposal-audio-script";
import { checkPortalWrite } from "@/lib/abuse/guards";
import { POLICIES } from "@/lib/abuse/policies";
import { requestIp } from "@/lib/abuse/rate-limit";
import type { Proposal } from "@/lib/proposal-mock";

// Spoken summary of the proposal for the client portal's "Listen"
// button. Generated lazily on the first play (most proposals are never
// listened to, and the price can still move via discount negotiation
// after sending) and cached in Vercel Blob keyed by a hash of the
// script text — a price change flips the hash and the next play
// regenerates with the new numbers. Replays are a DB read + JSON
// response; only cache misses spend TTS money, so only they are
// rate-limited.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTS_VOICE = "nova";
const TTS_INSTRUCTIONS =
  "Warm, friendly, and professional — a contractor's assistant reading a " +
  "written quote to a homeowner who is listening in the car. Easy pace, " +
  "speak the prices clearly.";

// Best model first, but OpenAI project keys can restrict the model list
// (ours 403s `model_not_found` on gpt-4o-mini-tts) — fall through to the
// classic tts-1, which every project has. `instructions` is only
// supported by the gpt-4o-* speech models, so it's per-candidate.
const TTS_CANDIDATES: Array<{ model: string; instructions?: string }> = [
  { model: "gpt-4o-mini-tts", instructions: TTS_INSTRUCTIONS },
  { model: "tts-1" },
];

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
  try {
    script = buildProposalAudioScript(row.data as unknown as Proposal);
  } catch (e) {
    console.error("[proposal-audio] script build failed", e);
    return NextResponse.json(
      { ok: false, reason: "This proposal can't be summarized as audio." },
      { status: 422 },
    );
  }
  const hash = audioScriptHash(script);

  // Cache hit: the stored audio was generated from this exact script.
  // The store is private, so the raw blob URL is useless to the browser
  // — mint a short-lived signed GET URL for this play.
  if (row.audioUrl && row.audioScriptHash === hash) {
    const playUrl = await presignPlayUrl(row.audioUrl);
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

  const openaiKey =
    (await getActiveApiKey("OPENAI")) ?? process.env.OPENAI_API_KEY;
  const geminiKey =
    (await getActiveApiKey("GEMINI")) ?? process.env.GEMINI_API_KEY;
  if (!openaiKey && !geminiKey) {
    return NextResponse.json(
      { ok: false, reason: "Audio isn't set up yet — please read the proposal instead." },
      { status: 503 },
    );
  }

  let result: TtsResult | null = null;
  if (openaiKey) result = await openAiTts(openaiKey, script);
  if (!result && geminiKey) result = await geminiTts(geminiKey, script);
  if (!result) {
    return NextResponse.json(
      { ok: false, reason: "Couldn't prepare the audio right now — please try again in a minute." },
      { status: 502 },
    );
  }

  // The Blob store is configured private, so the stored URL is only
  // reachable through the presigned GET URLs this route mints per play.
  const blob = await put(
    `proposal-audio/${row.id}/${hash}.${result.ext}`,
    result.audio,
    {
      access: "private",
      contentType: result.contentType,
      addRandomSuffix: true,
    },
  );

  // Two simultaneous first-plays can both generate; last write wins and
  // the loser's blob is orphaned — harmless at ~200 KB, not worth a lock.
  const stale = row.audioUrl;
  await db.proposal.update({
    where: { id: row.id },
    data: { audioUrl: blob.url, audioScriptHash: hash },
  });
  if (stale && stale !== blob.url) {
    try {
      await del(stale);
    } catch {
      // best-effort cleanup — an orphaned old file is fine
    }
  }

  const playUrl = await presignPlayUrl(blob.url);
  if (!playUrl) {
    return NextResponse.json(
      { ok: false, reason: "Couldn't prepare the audio right now — please try again in a minute." },
      { status: 502 },
    );
  }
  await logListened(row.id, request, false);
  return NextResponse.json({ ok: true, url: playUrl });
}

/** Same env-scan the blueprint routes use — Vercel prefixes the token
 *  name when the store is connected under a custom name. */
function resolveBlobToken(): string | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    if (k.endsWith("_READ_WRITE_TOKEN") || k.endsWith("_BLOB_READ_WRITE_TOKEN")) {
      return v;
    }
  }
  return null;
}

/**
 * Short-lived signed GET URL for a private blob. One hour comfortably
 * covers a listen session; the <audio> element keeps its src for
 * replays, and a fresh play after expiry re-fetches this route for a
 * new URL. Returns null (never throws) so callers can fall back.
 */
async function presignPlayUrl(blobUrl: string): Promise<string | null> {
  try {
    const token = resolveBlobToken();
    if (!token) {
      console.error("[proposal-audio] no blob token to presign with");
      return null;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(
        new URL(blobUrl).pathname.replace(/^\/+/, ""),
      );
    } catch {
      pathname = blobUrl.replace(/^\/+/, "");
    }
    const validUntil = Date.now() + 60 * 60 * 1000;
    const signedToken = await issueSignedToken({
      token,
      pathname,
      operations: ["get"],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      operation: "get",
      pathname,
      access: "private",
      validUntil,
    });
    return presignedUrl;
  } catch (e) {
    console.error("[proposal-audio] presign failed", e);
    return null;
  }
}

type TtsResult = { audio: Buffer; contentType: string; ext: string };

async function openAiTts(
  apiKey: string,
  script: string,
): Promise<TtsResult | null> {
  for (const candidate of TTS_CANDIDATES) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: candidate.model,
        voice: TTS_VOICE,
        input: script,
        ...(candidate.instructions
          ? { instructions: candidate.instructions }
          : {}),
        response_format: "mp3",
      }),
    });
    if (res.ok) {
      return {
        audio: Buffer.from(await res.arrayBuffer()),
        contentType: "audio/mpeg",
        ext: "mp3",
      };
    }
    const detail = await res.text().catch(() => "");
    console.error(
      `[proposal-audio] TTS failed (${res.status}, ${candidate.model})`,
      detail.slice(0, 500),
    );
    // Only a model-access rejection is worth retrying on the next
    // candidate — a bad key / quota error will fail them all the same.
    if (!detail.includes("model_not_found")) break;
  }
  return null;
}

/**
 * Gemini TTS fallback — the deployed OpenAI project key has a model
 * allowlist that rejects EVERY speech model (`model_not_found` on both
 * gpt-4o-mini-tts and tts-1), while the Gemini key is already live for
 * blueprint analysis. Gemini returns raw 16-bit mono PCM, so we wrap it
 * in a WAV header for the <audio> element.
 */
async function geminiTts(
  apiKey: string,
  script: string,
): Promise<TtsResult | null> {
  const model = "gemini-2.5-flash-preview-tts";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: script }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(
      `[proposal-audio] Gemini TTS failed (${res.status})`,
      detail.slice(0, 500),
    );
    return null;
  }
  const body = (await res.json().catch(() => null)) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    }>;
  } | null;
  const inline = body?.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData?.data,
  )?.inlineData;
  if (!inline?.data) {
    console.error("[proposal-audio] Gemini TTS returned no audio part");
    return null;
  }
  const pcm = Buffer.from(inline.data, "base64");
  const rate = parseInt(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? "", 10);
  return {
    audio: pcmToWav(pcm, Number.isFinite(rate) ? rate : 24000),
    contentType: "audio/wav",
    ext: "wav",
  };
}

/** Minimal RIFF/WAV header around 16-bit mono PCM. */
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
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
