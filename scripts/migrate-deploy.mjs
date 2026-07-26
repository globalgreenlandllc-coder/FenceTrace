#!/usr/bin/env node
/**
 * Resilient `prisma migrate deploy` for the Vercel build.
 *
 * Neon auto-suspends idle computes. A build's migrate step connects to the
 * DIRECT (unpooled) endpoint, and a cold compute can fail to answer within
 * Prisma's ~5s connect timeout → `P1001: Can't reach database server`,
 * which killed the deploy (see the build logs we hit during the outage).
 *
 * This wrapper retries the migrate on CONNECTIVITY errors only — the first
 * failed attempt is itself the wake-up call, so a subsequent retry lands
 * once Neon's compute is up. A genuine migration error (bad SQL, drift,
 * etc.) is NOT connectivity, so we fail fast on it and never mask it.
 *
 * No new env vars, no secrets — drop-in replacement for `prisma migrate
 * deploy` in the build script. Tunable via MIGRATE_MAX_ATTEMPTS /
 * MIGRATE_BACKOFF_MS if needed.
 */
import { spawnSync } from "node:child_process";

// 8 linear-backoff attempts ≈ 3.7 min of patience: the 5-attempt/~1-min
// window still lost a real build to a Neon cold/unreachable spell that the
// very next push sailed through — a cold compute (or a brief Neon incident)
// can take minutes, and a couple extra build minutes is far cheaper than a
// dead deploy.
const MAX_ATTEMPTS = Math.max(1, Number(process.env.MIGRATE_MAX_ATTEMPTS) || 8);
const BACKOFF_MS = Math.max(0, Number(process.env.MIGRATE_BACKOFF_MS) || 6000);

// Substrings that mark a transient CONNECTIVITY failure (retry), as opposed
// to a real migration failure (fail fast). Prisma surfaces P1001/P1002 for
// unreachable/timed-out servers; the raw socket errors cover edge cases.
const RETRYABLE = [
  "P1001",
  "P1002",
  "Can't reach database server",
  "the database server",
  "timed out",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
];

function isRetryable(output) {
  return RETRYABLE.some((needle) => output.includes(needle));
}

// Prisma's default connect timeout (~5s) is shorter than a Neon scale-to-zero
// wake-up can take, so the first attempt used to fail with P1001 and spray the
// build log with red before a retry landed. Giving the connector 30s covers
// the wake-up so the FIRST attempt succeeds on a cold compute.
const CONNECT_TIMEOUT_S = Math.max(
  1,
  Number(process.env.MIGRATE_CONNECT_TIMEOUT_S) || 30,
);

function withConnectTimeout(url) {
  if (!url || /[?&]connect_timeout=/.test(url)) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connect_timeout=${CONNECT_TIMEOUT_S}`;
}

const migrateEnv = {
  ...process.env,
  DATABASE_URL: withConnectTimeout(process.env.DATABASE_URL),
  DATABASE_URL_UNPOOLED: withConnectTimeout(process.env.DATABASE_URL_UNPOOLED),
};

// Synchronous sleep with no deps (keeps this a single-file, install-free
// build step). Blocks the thread for `ms`.
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const res = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    encoding: "utf8",
    env: migrateEnv,
  });

  const output = (res.stdout || "") + (res.stderr || "");

  if (res.status === 0) {
    // Only the winning attempt's output reaches the build log — the failed
    // attempts' P1001 spam stays buffered and dies here.
    if (res.stdout) process.stdout.write(res.stdout);
    if (attempt > 1) {
      console.log(
        `[migrate-deploy] succeeded on attempt ${attempt}/${MAX_ATTEMPTS}.`,
      );
    }
    process.exit(0);
  }

  // spawn itself failed (e.g. npx not found) — surface it, don't loop.
  if (res.error) {
    console.error(`[migrate-deploy] failed to launch prisma:`, res.error);
    process.exit(1);
  }

  if (!isRetryable(output)) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    console.error(
      `[migrate-deploy] migration failed (not a connectivity error) — failing the build without retry.`,
    );
    process.exit(res.status || 1);
  }

  if (attempt < MAX_ATTEMPTS) {
    const wait = BACKOFF_MS * attempt; // linear: 4s, 8s, 12s, …
    console.log(
      `[migrate-deploy] database not reachable yet (attempt ${attempt}/${MAX_ATTEMPTS}) — waiting ${Math.round(wait / 1000)}s for the Neon compute to wake…`,
    );
    sleepSync(wait);
  } else {
    // Out of attempts: NOW show what Prisma actually said, once.
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
}

console.error(
  `[migrate-deploy] database still unreachable after ${MAX_ATTEMPTS} attempts — failing the build.`,
);
process.exit(1);
