import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "fencetrace.impersonate";
export const IMPERSONATION_MAX_AGE_MS = 60 * 60 * 1000;

function getSigningKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY missing — cannot sign impersonation cookie",
    );
  }
  return Buffer.from(raw, "base64");
}

function sign(value: string): string {
  const sig = crypto
    .createHmac("sha256", getSigningKey())
    .update(value)
    .digest("base64url");
  return `${value}.${sig}`;
}

function verify(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const value = token.slice(0, idx);
  const expectedSig = token.slice(idx + 1);
  const actualSig = crypto
    .createHmac("sha256", getSigningKey())
    .update(value)
    .digest("base64url");
  const a = Buffer.from(expectedSig);
  const b = Buffer.from(actualSig);
  if (a.length !== b.length) return null;
  try {
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return value;
}

export async function setImpersonationCookie(sessionId: string) {
  const jar = await cookies();
  jar.set({
    name: COOKIE_NAME,
    value: sign(sessionId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(IMPERSONATION_MAX_AGE_MS / 1000),
  });
}

export async function clearImpersonationCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function readImpersonationSessionId(): Promise<string | null> {
  const jar = await cookies();
  const c = jar.get(COOKIE_NAME);
  if (!c?.value) return null;
  return verify(c.value);
}
