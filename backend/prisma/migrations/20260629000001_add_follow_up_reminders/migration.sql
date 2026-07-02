-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

-- CreateTable
CREATE TABLE "follow_up_reminders" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "sourceCommunicationLogId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "ReminderStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedReason" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follow_up_reminders_jobId_idx" ON "follow_up_reminders"("jobId");

-- CreateIndex
CREATE INDEX "follow_up_reminders_status_dueAt_idx" ON "follow_up_reminders"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "follow_up_reminders" ADD CONSTRAINT "follow_up_reminders_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_reminders" ADD CONSTRAINT "follow_up_reminders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_reminders" ADD CONSTRAINT "follow_up_reminders_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
