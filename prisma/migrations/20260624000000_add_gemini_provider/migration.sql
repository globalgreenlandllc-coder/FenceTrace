-- Add GEMINI to the ApiKeyProvider enum so a Google Gemini key can be
-- stored from /admin/api-keys and used as a second (cross-provider) vision
-- model for the blueprint roof read. Same idempotent pattern as the
-- ANTHROPIC migration so it's safe on dev (may already have it via db push)
-- and prod (missing it).

ALTER TYPE "ApiKeyProvider" ADD VALUE IF NOT EXISTS 'GEMINI';
