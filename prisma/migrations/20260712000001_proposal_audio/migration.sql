-- Audio summary ("Listen to this quote") for the client portal.
-- Written idempotently (IF NOT EXISTS guards) so it applies cleanly on
-- drifted local Neon branches as well as production.

-- Cached TTS audio: blob URL + hash of the script it was generated from.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "audioUrl" TEXT;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "audioScriptHash" TEXT;

-- Portal analytics: the client played the audio summary.
ALTER TYPE "ProposalEventKind" ADD VALUE IF NOT EXISTS 'LISTENED';
