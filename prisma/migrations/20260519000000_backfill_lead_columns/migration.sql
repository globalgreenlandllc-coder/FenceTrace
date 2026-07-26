-- Backfills 11 columns + 4 indexes that were added to the Prisma schema
-- via `prisma db push` against the dev DB and never captured as a
-- proper migration. The production DB never received them, so any
-- query referencing buildingType / projectKind / aiRelevance / etc.
-- 500s with P2022 ("column does not exist in the current database").
--
-- IF NOT EXISTS guards make this safe to re-run and safe to apply to
-- both the dev DB (already has the columns) and prod (missing them).

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "buildingType" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "projectKind" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "contractorName" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "ownerName" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "fixtures" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "workClass" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "aiSummary" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "aiRelevance" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "issuedDate" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "housingUnits" INTEGER;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "developmentType" TEXT;

-- Indexes referenced from @@index() in the schema. CREATE INDEX
-- IF NOT EXISTS is supported in Postgres and matches the naming
-- convention Prisma would have generated.
CREATE INDEX IF NOT EXISTS "leads_buildingType_idx" ON "leads"("buildingType");
CREATE INDEX IF NOT EXISTS "leads_projectKind_idx" ON "leads"("projectKind");
CREATE INDEX IF NOT EXISTS "leads_issuedDate_idx" ON "leads"("issuedDate");
CREATE INDEX IF NOT EXISTS "leads_developmentType_idx" ON "leads"("developmentType");
