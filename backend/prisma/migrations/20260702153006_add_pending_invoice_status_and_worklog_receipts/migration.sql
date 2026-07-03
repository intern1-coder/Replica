-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'PENDING_INVOICE';

-- CreateTable
CREATE TABLE "work_log_receipts" (
    "id" TEXT NOT NULL,
    "workLogId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_log_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_log_receipts_workLogId_idx" ON "work_log_receipts"("workLogId");

-- AddForeignKey
ALTER TABLE "work_log_receipts" ADD CONSTRAINT "work_log_receipts_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "work_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_log_receipts" ADD CONSTRAINT "work_log_receipts_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
