-- SOCRATA was added to the ApiKeyProvider enum in schema.prisma and
-- synced to dev via `prisma db push` — never captured as a migration.
-- Production runs without it, so any call to getActiveApiKey("SOCRATA")
-- crashes with Postgres error 22P02 ("invalid input value for enum").
-- That's what was breaking the admin "Sync leads now" button.
--
-- IF NOT EXISTS makes this idempotent — safe on dev (already has SOCRATA)
-- and prod (missing it).

ALTER TYPE "ApiKeyProvider" ADD VALUE IF NOT EXISTS 'SOCRATA';
