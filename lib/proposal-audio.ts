import { put, del, issueSignedToken, presignUrl } from "@vercel/blob";
import { db } from "@/lib/db";
import { getActiveApiKey } from "@/lib/api-keys";
import {
  audioScriptHash,
  buildProposalAudioScript,
} from "@/lib/proposal-audio-script";
import type { Proposal } from "@/lib/proposal-mock";

/**
 * proposal-audio.ts — generating and serving the spoken quote summary.
 *
 * Extracted from app/api/p/[token]/audio so BOTH entry points share one
 * implementation:
 *
 *  - sendProposal warms the audio at send time, so the homeowner's first
 *    tap plays immediately instead of waiting out a TTS round trip in a
 *    moving car;
 *  - the portal route still generates on demand, which covers proposals
 *    sent before this existed, a warm-up that failed or timed out, and
 *    any price change after sending (a negotiated discount reprices the
 *    script, the hash moves, and the next play regenerates).
 *
 * The blob store is private; playback always goes through a short-lived
 * presigned GET URL minted per play.
 */

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

export type ProposalAudioRow = {
  id: string;
  data: unknown;
  audioUrl: string | null;
  audioScriptHash: string | null;
};

/** The script this proposal should be speaking, and its cache key. */
export function scriptFor(row: Pick<ProposalAudioRow, "data">): {
  script: string;
  hash: string;
} {
  const script = buildProposalAudioScript(row.data as unknown as Proposal);
  return { script, hash: audioScriptHash(script) };
}

/** True when the stored audio was generated from this exact script. */
export function isAudioFresh(row: ProposalAudioRow, hash: string): boolean {
  return !!row.audioUrl && row.audioScriptHash === hash;
}

/**
 * Synthesize, store, and record the audio for a proposal. Returns the
 * blob URL, or null when no provider is configured or every provider
 * failed. Never throws — callers treat audio as optional.
 */
export async function generateProposalAudio(
  row: ProposalAudioRow,
  script: string,
  hash: string,
): Promise<string | null> {
  try {
    const openaiKey =
      (await getActiveApiKey("OPENAI")) ?? process.env.OPENAI_API_KEY;
    const geminiKey =
      (await getActiveApiKey("GEMINI")) ?? process.env.GEMINI_API_KEY;
    if (!openaiKey && !geminiKey) return null;

    let result: TtsResult | null = null;
    if (openaiKey) result = await openAiTts(openaiKey, script);
    if (!result && geminiKey) result = await geminiTts(geminiKey, script);
    if (!result) return null;

    // The Blob store is configured private, so the stored URL is only
    // reachable through the presigned GET URLs minted per play.
    //
    // Token passed explicitly: without it the SDK prefers OIDC auth when
    // VERCEL_OIDC_TOKEN + BLOB_STORE_ID are in the env (a `vercel env
    // pull` leaves both), and a stale local OIDC token turns every
    // upload into "Access denied".
    const blobToken = resolveBlobToken() ?? undefined;
    const blob = await put(
      `proposal-audio/${row.id}/${hash}.${result.ext}`,
      result.audio,
      {
        access: "private",
        contentType: result.contentType,
        addRandomSuffix: true,
        token: blobToken,
      },
    );

    // Two simultaneous generations can both land; last write wins and the
    // loser's blob is orphaned — harmless at ~200 KB, not worth a lock.
    const stale = row.audioUrl;
    await db.proposal.update({
      where: { id: row.id },
      data: { audioUrl: blob.url, audioScriptHash: hash },
    });
    if (stale && stale !== blob.url) {
      try {
        await del(stale, { token: blobToken });
      } catch {
        // best-effort cleanup — an orphaned old file is fine
      }
    }
    return blob.url;
  } catch (e) {
    console.error("[proposal-audio] generation failed", e);
    return null;
  }
}

/**
 * Warm the audio for a proposal that's being sent, so the client's first
 * play is instant. Best-effort and time-boxed: the send must not fail,
 * or noticeably stall, because a TTS provider is slow. Anything that
 * doesn't finish here is picked up lazily by the portal route.
 */
export async function warmProposalAudio(
  proposalId: string,
  timeoutMs = 12_000,
): Promise<boolean> {
  try {
    const row = await db.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, data: true, audioUrl: true, audioScriptHash: true },
    });
    if (!row) return false;
    const { script, hash } = scriptFor(row);
    if (isAudioFresh(row, hash)) return true;
    const done = await Promise.race([
      generateProposalAudio(row, script, hash),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    return !!done;
  } catch (e) {
    console.error("[proposal-audio] warm failed", e);
    return false;
  }
}

/** Same env-scan the blueprint routes use — Vercel prefixes the token
 *  name when the store is connected under a custom name. */
function resolveBlobToken(): string | null {
  if (process.env.BLOB_READ_WRITE_TOKEN)
    return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    if (
      k.endsWith("_READ_WRITE_TOKEN") ||
      k.endsWith("_BLOB_READ_WRITE_TOKEN")
    ) {
      return v;
    }
  }
  return null;
}

/**
 * Short-lived signed GET URL for a private blob. One hour comfortably
 * covers a listen session; the <audio> element keeps its src for
 * replays, and a fresh play after expiry re-fetches for a new URL.
 * Returns null (never throws) so callers can fall back.
 */
export async function presignPlayUrl(blobUrl: string): Promise<string | null> {
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
      content?: {
        parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
      };
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
  const rate = parseInt(
    /rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? "",
    10,
  );
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
