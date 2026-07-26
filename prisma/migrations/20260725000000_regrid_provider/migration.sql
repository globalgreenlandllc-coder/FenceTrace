-- Regrid parcel-data provider for the fence estimator's key vault.
-- Idempotent (dev DB drift).
ALTER TYPE "ApiKeyProvider" ADD VALUE IF NOT EXISTS 'REGRID';
