-- CreateEnum
CREATE TYPE "AppointmentWorkerResponse" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "workerDeclineReason" TEXT,
ADD COLUMN     "workerRespondedAt" TIMESTAMP(3),
ADD COLUMN     "workerResponse" "AppointmentWorkerResponse";

-- AlterTable
ALTER TABLE "job_assignments" ADD COLUMN     "previousStartsAt" TIMESTAMP(3),
ADD COLUMN     "rescheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "worker_payouts" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worker_payouts_ownerId_createdAt_idx" ON "worker_payouts"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "worker_payouts_workerId_idx" ON "worker_payouts"("workerId");

-- AddForeignKey
ALTER TABLE "worker_payouts" ADD CONSTRAINT "worker_payouts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_payouts" ADD CONSTRAINT "worker_payouts_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

