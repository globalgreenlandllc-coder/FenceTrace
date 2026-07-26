import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to your .env (and to Vercel env vars for production).",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be 32 raw bytes encoded as base64 (output of `openssl rand -base64 32`).",
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decrypt(token: string): string {
  const key = getKey();
  const buf = Buffer.from(token, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted token is malformed");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function fingerprint(plaintext: string): string {
  return crypto
    .createHash("sha256")
    .update(plaintext)
    .digest("hex")
    .slice(0, 12);
}

export function maskValue(plaintext: string): string {
  if (plaintext.length <= 8) return "•".repeat(plaintext.length);
  const head = plaintext.slice(0, 4);
  const tail = plaintext.slice(-4);
  return `${head}${"•".repeat(Math.min(plaintext.length - 8, 24))}${tail}`;
}
