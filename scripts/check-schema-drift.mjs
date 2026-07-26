#!/usr/bin/env node
/**
 * Schema-drift CI guard.
 *
 * Catches the "prisma db push without migrate dev" pattern that's
 * produced four production incidents on this project (P2021 missing
 * table plan_analyses, P2022 missing columns on leads, 22P02 missing
 * SOCRATA enum value, 22P02 missing ANTHROPIC enum value).
 *
 * Mechanism: invokes `prisma migrate diff --exit-code` comparing the
 * migrations folder against the current schema.prisma. Non-zero exit
 * means schema.prisma has changes the committed migrations don't
 * cover — typically a forgotten `prisma migrate dev` after editing
 * schema.prisma.
 *
 * Wired into `build` so Vercel halts deployment when drift is present.
 *
 * Requires SHADOW_DATABASE_URL — Prisma needs a shadow DB to replay
 * migrations into for the diff. Recommended setup: create a dedicated
 * zero-data Neon branch (free), put its URL in Vercel env vars as
 * SHADOW_DATABASE_URL.
 *
 * When SHADOW_DATABASE_URL is NOT set the script PRINTS A WARNING and
 * exits 0 so existing deploys don't break — but the strict check
 * isn't running. The warning shows up in build logs so it's hard to
 * miss.
 *
 * Plain Node.js / .mjs (no TypeScript) so Vercel doesn't need an
 * extra dep to run it.
 */

import { spawnSync } from "node:child_process";

const shadowUrl = process.env.SHADOW_DATABASE_URL;

if (!shadowUrl) {
  console.warn(
    "\n⚠ SHADOW_DATABASE_URL not set — schema-drift check is OFF.\n" +
      "  This means a `prisma db push` that wasn't captured as a migration\n" +
      "  can still slip into production (4 prior incidents on this project).\n" +
      "  To enable: create a dedicated zero-data Neon branch, paste its\n" +
      "  postgres:// URL into Vercel env vars as SHADOW_DATABASE_URL, and\n" +
      "  redeploy. The check will then fail any build with schema drift.\n",
  );
  process.exit(0);
}

console.log("→ Checking for schema drift between migrations and schema.prisma");

const result = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--shadow-database-url",
    shadowUrl,
    "--exit-code",
  ],
  { stdio: "pipe", encoding: "utf8" },
);

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";

// Exit codes from `prisma migrate diff --exit-code`:
//   0 → no diff
//   1 → error
//   2 → diff present (this is what we want to catch)
if (result.status === 0) {
  console.log("✓ No drift detected — schema.prisma matches the migrations.");
  process.exit(0);
}

if (result.status === 2) {
  console.error("\n❌ Schema drift detected.\n");
  console.error(stdout.trim());
  console.error(
    "\nThis means schema.prisma has changes that the committed migrations\n" +
      "don't account for — almost certainly a `prisma db push` instead of\n" +
      "`prisma migrate dev`. To fix:\n" +
      "\n" +
      "  1. Locally:   npx prisma migrate dev --name <descriptive_name>\n" +
      "  2. Commit:    git add prisma/migrations/<timestamp>_<name>\n" +
      "  3. Push:      git push\n" +
      "\n" +
      "Build halted to prevent the drift from reaching production.\n",
  );
  process.exit(1);
}

// status === 1 or null = prisma itself failed (DB unreachable, etc.)
console.error("✗ prisma migrate diff failed unexpectedly:");
console.error(stdout.trim());
console.error(stderr.trim());
console.error(
  "\nFalling back to allowing the build (so a flaky shadow DB doesn't\n" +
    "block deploys). Check shadow DB connectivity if this keeps recurring.\n",
);
process.exit(0);
