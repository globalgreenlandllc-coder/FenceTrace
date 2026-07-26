import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import type { ApiKeyProvider } from "@prisma/client";

/**
 * Server-internal helper. Returns the decrypted active key for a provider,
 * or null if none is configured. Records lastUsedAt.
 *
 * Do NOT export this from a "use server" file — it must never be reachable
 * from the client. Import directly from server-only code (route handlers,
 * server actions that already gate by role, AI/Stripe integrations).
 */
export async function getActiveApiKey(
  provider: ApiKeyProvider,
): Promise<string | null> {
  const row = await db.apiKey.findFirst({
    where: { provider, active: true },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  await db.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return decrypt(row.encryptedValue);
}
