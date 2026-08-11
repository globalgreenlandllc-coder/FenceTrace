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

/**
 * Accept a blob URL only if it actually points at Vercel Blob storage.
 *
 * Upload routes hand the client back a URL and the client hands it to a
 * server action to persist — so the URL makes a round trip through
 * untrusted hands. Without this check a worker could store any link they
 * liked on an expense and have the owner's financials page render it,
 * which is an open redirect at best and a phishing surface at worst.
 *
 * Returns null for anything that isn't an https Vercel Blob URL, so
 * callers can treat "no receipt" and "bad receipt" identically.
 */
export function safeBlobUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  // Vercel Blob public URLs are <store>.public.blob.vercel-storage.com.
  if (!u.hostname.endsWith(".blob.vercel-storage.com")) return null;
  return u.toString().slice(0, 1000);
}
