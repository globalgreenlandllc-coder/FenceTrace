-- Worker "Start job" → IN_PROGRESS timestamp. Idempotent (local dev DB drift).
ALTER TABLE "job_assignments" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
