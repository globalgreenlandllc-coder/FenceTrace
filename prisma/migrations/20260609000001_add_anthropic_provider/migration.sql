-- ANTHROPIC was added to the ApiKeyProvider enum + ALL_PROVIDERS array
-- + the admin UI's PROVIDER_META map, but never captured as a
-- migration. Same db-push-without-migrate-dev pattern that bit us with
-- SOCRATA, MAPBOX, FAL.
--
-- IF NOT EXISTS keeps it idempotent across dev (already has it) and
-- prod (missing it).

ALTER TYPE "ApiKeyProvider" ADD VALUE IF NOT EXISTS 'ANTHROPIC';
