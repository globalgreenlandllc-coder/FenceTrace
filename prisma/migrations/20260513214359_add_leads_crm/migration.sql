-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('APPLIED', 'UNDER_REVIEW', 'ISSUED', 'INSPECTION', 'FINALED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('UNREAD', 'VISITED', 'CONTACTED', 'BIDDING', 'NOT_INTERESTED');

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceCity" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "originalDescription" TEXT NOT NULL,
    "categorizedTrade" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'UNKNOWN',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "projectValue" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_lead_interactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "InteractionStatus" NOT NULL DEFAULT 'UNREAD',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_lead_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_latitude_longitude_idx" ON "leads"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "leads_categorizedTrade_status_idx" ON "leads"("categorizedTrade", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_sourceCity_sourceId_key" ON "leads"("sourceCity", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "user_lead_interactions_userId_leadId_key" ON "user_lead_interactions"("userId", "leadId");

-- AddForeignKey
ALTER TABLE "user_lead_interactions" ADD CONSTRAINT "user_lead_interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_lead_interactions" ADD CONSTRAINT "user_lead_interactions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
