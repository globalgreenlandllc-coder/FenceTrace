/**
 * Parse a Response body as JSON without crashing on empty / non-JSON
 * payloads. Vercel kills timed-out functions with a 500 + empty body,
 * which makes `await res.json()` throw "Unexpected end of JSON input"
 * and crashes whatever caller was trying to read the error message.
 *
 * Returns the parsed object on success, an `{ error }` object with a
 * descriptive message on failure (so callers can keep their existing
 * `data?.error` chains).
 */
export async function safeResponseJson<T = unknown>(
  res: Response,
): Promise<T | { error: string }> {
  const ctype = res.headers.get("content-type") ?? "";
  // Empty body → synthesize a meaningful error tied to the status.
  if (res.status === 204) return { error: "No content returned" };
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { error: `Failed to read response body (HTTP ${res.status})` };
  }
  if (!text.trim()) {
    // Vercel timeouts / function crashes land here.
    if (res.status >= 500) {
      return {
        error: `Server returned HTTP ${res.status} with no response body — likely a Vercel function timeout or crash. Try again with a smaller file, or check the deploy logs.`,
      };
    }
    return { error: `HTTP ${res.status} with empty body` };
  }
  // Non-JSON 500 (e.g. HTML error page from Vercel infra) — surface
  // the status + a snippet, not the raw HTML.
  if (!ctype.includes("application/json")) {
    const snippet = text.slice(0, 120).replace(/\s+/g, " ");
    return {
      error: `HTTP ${res.status} returned non-JSON: ${snippet}${text.length > 120 ? "…" : ""}`,
    };
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: `HTTP ${res.status} JSON parse failed: ${text.slice(0, 120)}`,
    };
  }
}
