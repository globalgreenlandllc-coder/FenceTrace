"use server";

import { revalidatePath } from "next/cache";
import type { ApiKeyProvider, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encrypt, decrypt, fingerprint } from "@/lib/crypto";
import { getMe } from "./me";

async function requireAdmin() {
  const me = await getMe();
  if (!me || me.user.role !== "SUPER_ADMIN") {
    throw new Error("Forbidden");
  }
  return me;
}

export type ApiKeyRow = {
  id: string;
  provider: ApiKeyProvider;
  label: string;
  fingerprint: string;
  active: boolean;
  lastUsedAt: string | null;
  rotatedAt: string | null;
  createdAt: string;
};

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  await requireAdmin();
  const rows = await db.apiKey.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: r.label,
    fingerprint: r.fingerprint,
    active: r.active,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    rotatedAt: r.rotatedAt ? r.rotatedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type CreateApiKeyResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

export async function createApiKey(args: {
  provider: ApiKeyProvider;
  label: string;
  value: string;
}): Promise<CreateApiKeyResult> {
  // Wrap the whole action in a single try/catch and convert every
  // failure into a structured result. Without this, throws bubble
  // past the server action boundary and Next.js production strips
  // the message into 'An error occurred in the Server Components
  // render' — leaving the admin staring at a useless modal.
  try {
    const me = await requireAdmin();
    const value = args.value.trim();
    if (value.length < 8) {
      return {
        ok: false,
        reason: "Key value looks too short to be a real credential.",
      };
    }
    // Reject obvious non-credentials. None of the providers we vault
    // (Resend, OpenAI, Anthropic, Fal, Mapbox, Socrata, Stripe…) use
    // email-formatted credentials, so an admin pasting an email here
    // is always a mistake — and storing it makes the rest of the flow
    // misleading (the 'Test' / 'Send test email' button would just
    // surface a confusing 401).
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return {
        ok: false,
        reason:
          "That looks like an email address, not an API key. Open the provider's dashboard (Resend → API Keys for Resend) and copy the secret key — usually a long string starting with 're_' / 'sk_' / etc.",
      };
    }
    // Provider-specific format hints. Catches cases where the admin
    // pastes a different provider's key by mistake (e.g. an OpenAI
    // key into the Resend slot). Soft check — only flags very
    // obvious mismatches.
    if (args.provider === "RESEND" && !value.startsWith("re_")) {
      return {
        ok: false,
        reason:
          "Resend API keys start with 're_'. Paste the key from resend.com → API Keys (not an email, not an OpenAI/Anthropic key).",
      };
    }
    const fp = fingerprint(value);
    const dup = await db.apiKey.findUnique({
      where: {
        provider_fingerprint: { provider: args.provider, fingerprint: fp },
      },
    });
    if (dup) {
      return {
        ok: false,
        reason:
          "This exact key value is already stored for this provider. Rotate the existing entry instead.",
      };
    }

    await db.apiKey.updateMany({
      where: { provider: args.provider, active: true },
      data: { active: false, rotatedAt: new Date() },
    });

    const created = await db.apiKey.create({
      data: {
        provider: args.provider,
        label: args.label.trim() || `${args.provider} key`,
        encryptedValue: encrypt(value),
        fingerprint: fp,
        active: true,
        createdBy: me.user.id,
      },
    });

    await db.auditLog.create({
      data: {
        actorId: me.user.id,
        action: "API_KEY_CREATED",
        targetType: "ApiKey",
        targetId: created.id,
        payload: {
          provider: args.provider,
          fingerprint: fp,
          label: created.label,
        } as Prisma.InputJsonValue,
      },
    });

    revalidatePath("/admin/api-keys");
    return { ok: true, id: created.id };
  } catch (e) {
    console.error("[createApiKey] threw", e);
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return {
      ok: false,
      reason: msg.startsWith("Forbidden")
        ? "You're not signed in as a super-admin."
        : msg,
    };
  }
}

export async function revealApiKey(
  id: string,
): Promise<{ value: string; fingerprint: string; provider: ApiKeyProvider }> {
  const me = await requireAdmin();
  const row = await db.apiKey.findUnique({ where: { id } });
  if (!row) throw new Error("Not found");

  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "API_KEY_VIEWED",
      targetType: "ApiKey",
      targetId: id,
      payload: {
        provider: row.provider,
        fingerprint: row.fingerprint,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    value: decrypt(row.encryptedValue),
    fingerprint: row.fingerprint,
    provider: row.provider,
  };
}

export async function revokeApiKey(id: string): Promise<{ ok: true }> {
  const me = await requireAdmin();
  const before = await db.apiKey.findUnique({ where: { id } });
  if (!before) throw new Error("Not found");
  await db.apiKey.update({
    where: { id },
    data: { active: false, rotatedAt: new Date() },
  });
  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "API_KEY_REVOKED",
      targetType: "ApiKey",
      targetId: id,
      payload: {
        provider: before.provider,
        fingerprint: before.fingerprint,
      } as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/admin/api-keys");
  return { ok: true };
}

export async function rotateApiKey(args: {
  id: string;
  newValue: string;
}): Promise<{ ok: true; id: string }> {
  const me = await requireAdmin();
  const value = args.newValue.trim();
  if (value.length < 8) {
    throw new Error("New key value looks too short to be a real credential.");
  }
  const before = await db.apiKey.findUnique({ where: { id: args.id } });
  if (!before) throw new Error("Not found");

  const fp = fingerprint(value);
  if (fp === before.fingerprint) {
    throw new Error("New value matches the current key — nothing to rotate.");
  }
  const dup = await db.apiKey.findUnique({
    where: {
      provider_fingerprint: { provider: before.provider, fingerprint: fp },
    },
  });
  if (dup) {
    throw new Error(
      "That key value is already stored as a prior row for this provider. Pick a different one.",
    );
  }

  await db.apiKey.update({
    where: { id: args.id },
    data: { active: false, rotatedAt: new Date() },
  });

  const created = await db.apiKey.create({
    data: {
      provider: before.provider,
      label: before.label,
      encryptedValue: encrypt(value),
      fingerprint: fp,
      active: true,
      createdBy: me.user.id,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: me.user.id,
      action: "API_KEY_ROTATED",
      targetType: "ApiKey",
      targetId: created.id,
      payload: {
        provider: before.provider,
        oldId: before.id,
        oldFingerprint: before.fingerprint,
        newFingerprint: fp,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/admin/api-keys");
  return { ok: true, id: created.id };
}

export type TestApiKeyReason =
  | "ok"
  | "invalid_key"
  | "quota_exceeded"
  | "network_error"
  | "not_implemented"
  | "unknown_error";

export type TestApiKeyResult = {
  ok: boolean;
  /** Provider-specific human-readable status. */
  status: string;
  /** Raw error from the provider, if any. Surface in admin UI. */
  error: string | null;
  /** Token fingerprint we tested against — confirms which key was used. */
  testedFingerprint: string | null;
  /** Coarse classification so the UI can render a distinct "out of
   *  credits" treatment instead of a generic red error box. */
  reason: TestApiKeyReason;
};

/**
 * Validates the stored key for a provider by hitting a lightweight
 * provider endpoint. Designed for the admin "Test" button so you can
 * tell *which* problem you're hitting — bad key vs out-of-credits vs
 * network — without waiting for it to surface as a failed analysis.
 *
 * Every branch below makes one small real call against the provider
 * (a few fractions of a cent at most for the paid ones — OpenAI
 * embeddings ping, Anthropic 1-token message, fal.ai billing read,
 * Google Geocoding) so that "out of credits" is detected from the
 * provider's own response, not guessed.
 */
export async function testApiKey(
  id: string,
): Promise<TestApiKeyResult> {
  try {
    await requireAdmin();
  } catch (e) {
    return {
      ok: false,
      status: "Not authorized",
      error: e instanceof Error ? e.message : String(e),
      testedFingerprint: null,
      reason: "unknown_error",
    };
  }

  try {
    const row = await db.apiKey.findUnique({ where: { id } });
    if (!row) {
      return {
        ok: false,
        status: "Key not found",
        error: null,
        testedFingerprint: null,
        reason: "unknown_error",
      };
    }

    let value: string;
    try {
      value = decrypt(row.encryptedValue);
    } catch (e) {
      // Decrypt fails when the stored ciphertext was written with a
      // different APP_ENCRYPTION_KEY than the one currently set, or
      // when the stored value is malformed. Either way, the contractor
      // needs to Rotate the key in this UI, not file a bug.
      return {
        ok: false,
        status: "Could not decrypt stored key (encryption key changed or row corrupt)",
        error: e instanceof Error ? e.message : String(e),
        testedFingerprint: row.fingerprint,
        reason: "unknown_error",
      };
    }
    if (!value) {
      return {
        ok: false,
        status: "Stored key is empty",
        error: null,
        testedFingerprint: row.fingerprint,
        reason: "unknown_error",
      };
    }

    const fp = row.fingerprint;

    if (row.provider === "RESEND") {
      try {
        const res = await fetch("https://api.resend.com/api-keys", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${value}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          name?: string;
        };
        if (res.ok) {
          return {
            ok: true,
            status: "Resend accepted the key — sending should work",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        return {
          ok: false,
          status: `Resend rejected the key (HTTP ${res.status})`,
          error: body.message ?? body.name ?? `HTTP ${res.status}`,
          testedFingerprint: fp,
          reason: res.status === 401 ? "invalid_key" : "unknown_error",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching Resend",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    if (row.provider === "OPENAI") {
      // Cheapest real inference call there is (fractions of a cent) —
      // listing models doesn't touch billing, so it can't tell "no
      // credit" apart from "fine". This can.
      try {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${value}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: "text-embedding-3-small", input: "ping" }),
          cache: "no-store",
        });
        if (res.ok) {
          return {
            ok: true,
            status: "OpenAI accepted the key and ran a real request",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; code?: string };
        };
        const code = body.error?.code ?? "";
        const message = body.error?.message ?? `HTTP ${res.status}`;
        if (code === "insufficient_quota") {
          return {
            ok: false,
            status: "OpenAI account is out of credit",
            error: message,
            testedFingerprint: fp,
            reason: "quota_exceeded",
          };
        }
        if (res.status === 401 || code === "invalid_api_key") {
          return {
            ok: false,
            status: "OpenAI rejected the key as invalid",
            error: message,
            testedFingerprint: fp,
            reason: "invalid_key",
          };
        }
        return {
          ok: false,
          status: `OpenAI rejected the request (HTTP ${res.status})`,
          error: message,
          testedFingerprint: fp,
          reason: "unknown_error",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching OpenAI",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    if (row.provider === "ANTHROPIC") {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": value,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
          cache: "no-store",
        });
        if (res.ok) {
          return {
            ok: true,
            status: "Anthropic accepted the key and ran a real request",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; type?: string };
        };
        const message = body.error?.message ?? `HTTP ${res.status}`;
        if (/credit balance is too low|insufficient\s+cred/i.test(message)) {
          return {
            ok: false,
            status: "Anthropic account is out of credit",
            error: message,
            testedFingerprint: fp,
            reason: "quota_exceeded",
          };
        }
        if (res.status === 401 || body.error?.type === "authentication_error") {
          return {
            ok: false,
            status: "Anthropic rejected the key as invalid",
            error: message,
            testedFingerprint: fp,
            reason: "invalid_key",
          };
        }
        return {
          ok: false,
          status: `Anthropic rejected the request (HTTP ${res.status})`,
          error: message,
          testedFingerprint: fp,
          reason: "unknown_error",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching Anthropic",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    if (row.provider === "FAL") {
      try {
        const res = await fetch(
          "https://api.fal.ai/v1/account/billing?expand=credits",
          {
            method: "GET",
            headers: { Authorization: `Key ${value}` },
            cache: "no-store",
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          credits?: { current_balance?: number; currency?: string };
          message?: string;
        };
        if (res.ok) {
          const balance = body.credits?.current_balance;
          if (typeof balance === "number" && balance <= 0) {
            return {
              ok: false,
              status: `fal.ai balance is $${balance.toFixed(2)}`,
              error: null,
              testedFingerprint: fp,
              reason: "quota_exceeded",
            };
          }
          return {
            ok: true,
            status:
              typeof balance === "number"
                ? `fal.ai accepted the key — balance $${balance.toFixed(2)}`
                : "fal.ai accepted the key",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        return {
          ok: false,
          status:
            res.status === 401 || res.status === 403
              ? "fal.ai rejected the billing check (invalid key, or a key without billing-read access)"
              : `fal.ai rejected the request (HTTP ${res.status})`,
          error: body.message ?? `HTTP ${res.status}`,
          testedFingerprint: fp,
          reason: res.status === 401 ? "invalid_key" : "unknown_error",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching fal.ai",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    if (row.provider === "GEMINI") {
      try {
        const listRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(value)}`,
          { cache: "no-store" },
        );
        const listBody = (await listRes.json().catch(() => ({}))) as {
          error?: { message?: string; status?: string };
          models?: { name: string; supportedGenerationMethods?: string[] }[];
        };
        if (!listRes.ok) {
          return {
            ok: false,
            status:
              listRes.status === 400 || listRes.status === 403
                ? "Google rejected the Gemini key as invalid"
                : `Gemini rejected the request (HTTP ${listRes.status})`,
            error: listBody.error?.message ?? `HTTP ${listRes.status}`,
            testedFingerprint: fp,
            reason:
              listRes.status === 400 || listRes.status === 403
                ? "invalid_key"
                : "unknown_error",
          };
        }
        // Pick a real model this key can see rather than hardcoding a
        // generation name that may age out — prefer a "flash" model
        // for the cheapest possible real call.
        const usable = (listBody.models ?? []).filter((m) =>
          m.supportedGenerationMethods?.includes("generateContent"),
        );
        const model =
          usable.find((m) => m.name.includes("flash")) ?? usable[0];
        if (!model) {
          return {
            ok: true,
            status: "Gemini key is valid (no generateContent model to test billing with)",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        const genRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${model.name}:generateContent?key=${encodeURIComponent(value)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "hi" }] }],
              generationConfig: { maxOutputTokens: 1 },
            }),
            cache: "no-store",
          },
        );
        if (genRes.ok) {
          return {
            ok: true,
            status: "Gemini accepted the key and ran a real request",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        const genBody = (await genRes.json().catch(() => ({}))) as {
          error?: { message?: string; status?: string };
        };
        const message = genBody.error?.message ?? `HTTP ${genRes.status}`;
        if (genRes.status === 429) {
          return {
            ok: false,
            status: "Gemini quota exceeded (rate limit or billing account exhausted)",
            error: message,
            testedFingerprint: fp,
            reason: "quota_exceeded",
          };
        }
        return {
          ok: false,
          status: `Gemini rejected the request (HTTP ${genRes.status})`,
          error: message,
          testedFingerprint: fp,
          reason: "unknown_error",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching Gemini",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    if (row.provider === "GOOGLE_MAPS" || row.provider === "GOOGLE_SOLAR") {
      // Probes the underlying Google Cloud project via the Geocoding
      // API — the cheapest reliable signal for "this project's billing
      // is dead" (OVER_QUERY_LIMIT), shared across every API enabled on
      // the same key. A REQUEST_DENIED here can also just mean this
      // particular key is restricted to the Solar API only, so we don't
      // call that one "invalid" — only the unambiguous quota case.
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=1600+Amphitheatre+Parkway&key=${encodeURIComponent(value)}`,
          { cache: "no-store" },
        );
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
          error_message?: string;
        };
        if (body.status === "OK") {
          // FenceScan also needs the Elevation service (terrain-aware
          // estimating) — probe it too so a disabled toggle is caught
          // HERE, on the Test button, not as a blank readout in the
          // estimator.
          if (row.provider === "GOOGLE_MAPS") {
            try {
              const elev = await fetch(
                `https://maps.googleapis.com/maps/api/elevation/json?locations=39.74,-104.98&key=${encodeURIComponent(value)}`,
                { cache: "no-store" },
              );
              const elevBody = (await elev.json().catch(() => ({}))) as {
                status?: string;
              };
              if (elevBody.status !== "OK") {
                return {
                  ok: false,
                  status:
                    "Geocoding works, but the Elevation API is not enabled on this key — terrain-aware estimating needs it. Enable “Elevation API” in Google Cloud console → APIs & Services → Library.",
                  error: elevBody.status ?? "no response",
                  testedFingerprint: fp,
                  reason: "invalid_key",
                };
              }
            } catch {
              // network blip — don't fail the whole test over the probe
            }
          }
          return {
            ok: true,
            status:
              row.provider === "GOOGLE_MAPS"
                ? "Google accepted the key — Geocoding ✓ and Elevation ✓ (terrain ready)"
                : "Google accepted the key (tested via Geocoding API)",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        if (body.status === "OVER_QUERY_LIMIT") {
          return {
            ok: false,
            status: "Google Cloud billing/quota is exhausted for this project",
            error: body.error_message ?? body.status,
            testedFingerprint: fp,
            reason: "quota_exceeded",
          };
        }
        if (body.status === "REQUEST_DENIED") {
          const referer = /referer/i.test(body.error_message ?? "");
          return {
            ok: false,
            status:
              row.provider === "GOOGLE_SOLAR"
                ? "Geocoding API denied this key — may just mean it's restricted to the Solar API only"
                : referer
                  ? "This key is browser-restricted (HTTP referrers) — that's fine for the Leads map, and scans/terrain automatically use the server key from the environment instead. To pass every check with ONE key: in Google Cloud console → Credentials → this key, set Application restrictions to “None” and use API restrictions (Geocoding, Maps Static, Elevation, Maps JavaScript) as the guard."
                  : "Google rejected the key",
            error: body.error_message ?? body.status,
            testedFingerprint: fp,
            reason: row.provider === "GOOGLE_SOLAR" ? "unknown_error" : "invalid_key",
          };
        }
        return {
          ok: false,
          status: `Google returned ${body.status ?? `HTTP ${res.status}`}`,
          error: body.error_message ?? null,
          testedFingerprint: fp,
          reason: "unknown_error",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching Google",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    if (row.provider === "MAPBOX") {
      try {
        const res = await fetch(
          `https://api.mapbox.com/styles/v1/mapbox/streets-v11?access_token=${encodeURIComponent(value)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          return {
            ok: true,
            status: "Mapbox accepted the token",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        return {
          ok: false,
          status:
            res.status === 401
              ? "Mapbox rejected the token as invalid"
              : `Mapbox rejected the request (HTTP ${res.status})`,
          error: body.message ?? `HTTP ${res.status}`,
          testedFingerprint: fp,
          reason: res.status === 401 ? "invalid_key" : "unknown_error",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching Mapbox",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    if (row.provider === "REPORTALL") {
      // Real end-to-end lookup of the docs' own example parcel — proves
      // the client key AND the geometry pipeline in one shot. Costs 1
      // parcel of the monthly quota per click, which is what a test
      // button is for. Invalid keys come back HTTP 200 with a non-OK
      // status body, so the body is the verdict, not the HTTP code.
      try {
        const u = new URL("https://reportallusa.com/api/parcels");
        u.searchParams.set("client", value);
        u.searchParams.set("v", "9");
        u.searchParams.set("region", "Geauga County, OH");
        u.searchParams.set("address", "100 Short Court");
        u.searchParams.set("returnGeometry", "true");
        u.searchParams.set("rpp", "1");
        const res = await fetch(u.toString(), { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
          message?: string;
          count?: number;
          results?: { geom_as_wkt?: string }[];
        };
        if (res.ok && body.status === "OK") {
          const gotGeom = !!body.results?.[0]?.geom_as_wkt;
          return {
            ok: true,
            status: gotGeom
              ? "ReportAll accepted the key and returned a parcel with geometry"
              : "ReportAll accepted the key (parcel found, no geometry field)",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        return {
          ok: false,
          status: `ReportAll rejected the key${body.message ? ` — ${body.message}` : ""}`,
          error: body.message ?? body.status ?? `HTTP ${res.status}`,
          testedFingerprint: fp,
          reason: "invalid_key",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching ReportAll",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    if (row.provider === "REGRID") {
      try {
        const u = new URL("https://app.regrid.com/api/v2/parcels/address");
        u.searchParams.set("query", "1600 Pennsylvania Ave NW, Washington DC");
        u.searchParams.set("limit", "1");
        u.searchParams.set("token", value);
        const res = await fetch(u.toString(), { cache: "no-store" });
        if (res.ok) {
          return {
            ok: true,
            status: "Regrid accepted the token and answered a parcel query",
            error: null,
            testedFingerprint: fp,
            reason: "ok",
          };
        }
        const body = (await res.json().catch(() => ({}))) as {
          message?: string; error?: string;
        };
        return {
          ok: false,
          status:
            res.status === 401 || res.status === 403
              ? "Regrid rejected the token as invalid"
              : `Regrid rejected the request (HTTP ${res.status})`,
          error: body.message ?? body.error ?? `HTTP ${res.status}`,
          testedFingerprint: fp,
          reason: res.status === 401 || res.status === 403 ? "invalid_key" : "unknown_error",
        };
      } catch (e) {
        return {
          ok: false,
          status: "Network error reaching Regrid",
          error: e instanceof Error ? e.message : String(e),
          testedFingerprint: fp,
          reason: "network_error",
        };
      }
    }

    return {
      ok: false,
      status: `Test not implemented for ${row.provider} yet`,
      error: null,
      testedFingerprint: fp,
      reason: "not_implemented",
    };
  } catch (e) {
    console.error("[testApiKey] unexpected throw", e);
    return {
      ok: false,
      status: "Unexpected server error during test",
      error: e instanceof Error ? e.message : String(e),
      testedFingerprint: null,
      reason: "unknown_error",
    };
  }
}

export type SendTestEmailResult = {
  ok: boolean;
  /** Resend's message ID when ok, error message when not. */
  detail: string;
  /** Where the email was sent FROM (so the admin can see the
   *  configured sender). */
  from: string;
  /** Recipient confirmation. */
  to: string;
};

/**
 * Composes + delivers a real test email via the stored Resend key.
 * Lets the admin verify the full pipeline — vault decrypt → Resend
 * accept → actual deliverability — without going through the proposal
 * flow. Returns Resend's message ID on success; the email will land
 * in the recipient's inbox within seconds.
 *
 * Uses sendEmailViaResend so the From / Reply-To rules stay identical
 * to a real proposal send. If the contractor has set RESEND_FROM_EMAIL
 * to their verified domain, the test will come from there too.
 */
export async function sendTestEmail(args: {
  to: string;
}): Promise<SendTestEmailResult> {
  try {
    const me = await requireAdmin();
    const trimmed = args.to.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return {
        ok: false,
        detail: "Recipient email looks invalid (need name@domain.tld).",
        from: "",
        to: trimmed,
      };
    }
    const { sendEmailViaResend } = await import("@/lib/email/resend");
    const fromName = me.profile.contractorName || "FenceScan Admin";
    const fromEmail =
      process.env.RESEND_FROM_EMAIL?.trim() || "onboarding@resend.dev";
    const res = await sendEmailViaResend({
      to: trimmed,
      fromName,
      replyTo: me.user.email,
      subject: "FenceScan — Resend deliverability test",
      html:
        `<div style="font-family:system-ui,sans-serif;color:#0f172a;line-height:1.5">` +
        `<h2 style="margin:0 0 8px">Resend test ✓</h2>` +
        `<p>If you're reading this, your Resend API key + sender domain are wired correctly and proposals will go out.</p>` +
        `<p style="color:#64748b;font-size:13px">Sent from the FenceScan admin console at ${new Date().toISOString()}.</p>` +
        `</div>`,
      text:
        "Resend test — if you're reading this, your Resend API key + sender domain are wired correctly and proposals will go out.\n\n" +
        `Sent from the FenceScan admin console at ${new Date().toISOString()}.`,
    });
    if (res.ok) {
      return {
        ok: true,
        detail: `Resend accepted the message: ${res.id}. Should land within 30s.`,
        from: `${fromName} <${fromEmail}>`,
        to: trimmed,
      };
    }
    return {
      ok: false,
      detail: res.reason,
      from: `${fromName} <${fromEmail}>`,
      to: trimmed,
    };
  } catch (e) {
    console.error("[sendTestEmail] threw", e);
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "Unexpected error",
      from: "",
      to: args.to,
    };
  }
}

export type ApiKeyAuditEntry = {
  id: string;
  action: string;
  actorEmail: string;
  payload: Record<string, unknown>;
  at: string;
};

export async function listApiKeyAudit(
  limit = 25,
): Promise<ApiKeyAuditEntry[]> {
  await requireAdmin();
  const rows = await db.auditLog.findMany({
    where: {
      action: {
        in: [
          "API_KEY_CREATED",
          "API_KEY_ROTATED",
          "API_KEY_REVOKED",
          "API_KEY_VIEWED",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: true },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actor.email,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    at: r.createdAt.toISOString(),
  }));
}
