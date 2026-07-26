import "server-only";

/**
 * Resolve the Vercel Blob read/write token. Prefers the canonical
 * BLOB_READ_WRITE_TOKEN, then falls back to any store-prefixed
 * `*_READ_WRITE_TOKEN` / `*_BLOB_READ_WRITE_TOKEN` var (Vercel names the token
 * after the store when a project has several). Returns null when none is set so
 * callers can fail with a clear "storage not configured" message.
 *
 * Shared so the upload routes don't each carry their own drifting copy.
 */
export function resolveBlobToken(): string | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    if (k.endsWith("_READ_WRITE_TOKEN") || k.endsWith("_BLOB_READ_WRITE_TOKEN")) {
      return v;
    }
  }
  return null;
}
