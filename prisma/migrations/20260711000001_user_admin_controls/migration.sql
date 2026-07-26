-- Admin user controls: audit actions for role + plan changes.
-- Idempotent ADD VALUE (can't be wrapped in a DO/txn block), matching the
-- repo's enum-add idiom.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_ROLE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_PLAN_CHANGED';
