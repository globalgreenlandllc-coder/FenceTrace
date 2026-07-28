-- Market-price quotes get their own spend ledger kind (idempotent —
-- safe on drifted local branches).
ALTER TYPE "SpendKind" ADD VALUE IF NOT EXISTS 'AI_PRICE_QUOTE';
