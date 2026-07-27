"use server";

import { getMe } from "@/app/actions/me";
import { getActiveApiKey } from "@/lib/api-keys";
import { consumeLimit } from "@/lib/abuse/rate-limit";
import { POLICIES } from "@/lib/abuse/policies";

/**
 * address-suggest.ts — Google Places autocomplete behind a server
 * action, so the Maps key never reaches the browser.
 *
 * Same key-fallback dance as the scan/topo actions: the vault key may
 * be browser-referrer-restricted (added for the leads map) and Google
 * denies it server-side — try it first, then the env key. Needs the
 * "Places API" service enabled on whichever key wins.
 *
 * The client debounces; this action still carries its own generous
 * per-user budget so a stuck key can't hammer Google.
 */

export type AddressSuggestResult =
  | { ok: true; suggestions: string[] }
  | { ok: false; reason: string };

export async function suggestAddresses(input: {
  query: string;
  /** Per-typing-session token — groups autocomplete calls for Google's
   *  session billing. Any opaque string. */
  sessionToken?: string;
}): Promise<AddressSuggestResult> {
  const me = await getMe();
  if (!me) return { ok: false, reason: "Not signed in" };

  const q = (input.query ?? "").trim().slice(0, 120);
  if (q.length < 4) return { ok: true, suggestions: [] };

  const rl = await consumeLimit({
    policy: POLICIES.addressSuggest,
    key: `address-suggest:${me.user.id}`,
    context: { userId: me.user.id, route: "address-suggest" },
  });
  if (!rl.ok) return { ok: false, reason: rl.reason };

  const vaultKey = await getActiveApiKey("GOOGLE_MAPS");
  const envKey = process.env.GOOGLE_MAPS_API_KEY ?? null;
  const keys = [...new Set([vaultKey, envKey].filter(Boolean))] as string[];
  if (keys.length === 0) return { ok: false, reason: "Google Maps key missing" };

  let lastStatus: string | null = null;
  for (const key of keys) {
    const u = new URL(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json",
    );
    u.searchParams.set("input", q);
    u.searchParams.set("types", "address");
    u.searchParams.set("components", "country:us");
    u.searchParams.set("language", "en");
    if (input.sessionToken) {
      u.searchParams.set("sessiontoken", input.sessionToken.slice(0, 64));
    }
    u.searchParams.set("key", key);
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) {
        lastStatus = `HTTP ${res.status}`;
        continue;
      }
      const body = (await res.json()) as {
        status?: string;
        predictions?: { description?: string }[];
      };
      if (body.status === "OK" || body.status === "ZERO_RESULTS") {
        const suggestions = (body.predictions ?? [])
          .map((p) => (typeof p.description === "string" ? p.description : ""))
          .filter(Boolean)
          .slice(0, 6);
        return { ok: true, suggestions };
      }
      lastStatus = body.status ?? "no response";
      if (lastStatus !== "REQUEST_DENIED") break; // real error — don't spam keys
    } catch {
      lastStatus = "network";
    }
  }
  return {
    ok: false,
    reason:
      lastStatus === "REQUEST_DENIED"
        ? "Google denied the address search — enable the “Places API” service on your Maps key (APIs & Services → Library)."
        : `Address search unavailable (${lastStatus ?? "no response"})`,
  };
}
