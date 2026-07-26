-- Add PROMPT_TEMPLATE_UPDATED to the AuditAction enum for admin AI-prompt edits.
-- Kept in its own migration (enum ADD VALUE), idempotent across dev/prod.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROMPT_TEMPLATE_UPDATED';
