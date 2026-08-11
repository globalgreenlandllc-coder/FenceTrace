-- ReportAll USA joins the key vault as a parcel-boundary provider
-- (cheaper per-parcel than Regrid; either can serve the fence scan).
-- Idempotent per house rule.
ALTER TYPE "ApiKeyProvider" ADD VALUE IF NOT EXISTS 'REPORTALL';
