-- AlterEnum: add the WORKER role
ALTER TYPE "UserRole" ADD VALUE 'WORKER';

-- CreateEnum
CREATE TYPE "WorkerStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('GUTTERS_REPLACEMENT', 'GUTTERS_NEW', 'ROOF', 'REPAIR', 'OTHER');

-- CreateEnum
CREATE TYPE "JobAssignmentStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "trade" TEXT,
    "status" "WorkerStatus" NOT NULL DEFAULT 'INVITED',
    "inviteToken" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_assignments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "proposalId" TEXT,
    "title" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "clientName" TEXT,
    "clientPhone" TEXT,
    "kind" "JobKind" NOT NULL DEFAULT 'GUTTERS_REPLACEMENT',
    "scope" TEXT,
    "workerPayCents" INTEGER NOT NULL DEFAULT 0,
    "roofSnapshot" JSONB,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "JobAssignmentStatus" NOT NULL DEFAULT 'OFFERED',
    "declineReason" TEXT,
    "respondedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workers_inviteToken_key" ON "workers"("inviteToken");

-- CreateIndex
CREATE INDEX "workers_ownerId_idx" ON "workers"("ownerId");

-- CreateIndex
CREATE INDEX "workers_userId_idx" ON "workers"("userId");

-- CreateIndex
CREATE INDEX "workers_inviteToken_idx" ON "workers"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "workers_ownerId_email_key" ON "workers"("ownerId", "email");

-- CreateIndex
CREATE INDEX "job_assignments_ownerId_startsAt_idx" ON "job_assignments"("ownerId", "startsAt");

-- CreateIndex
CREATE INDEX "job_assignments_workerId_startsAt_idx" ON "job_assignments"("workerId", "startsAt");

-- CreateIndex
CREATE INDEX "job_assignments_proposalId_idx" ON "job_assignments"("proposalId");

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
