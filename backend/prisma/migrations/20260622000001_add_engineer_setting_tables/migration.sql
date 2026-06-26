-- CreateTable: engineers (separate from users)
CREATE TABLE "engineers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "hourlyRate" DECIMAL(10,2),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: settings (key/value config store)
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "engineers_name_idx" ON "engineers"("name");

-- Migrate existing CONTRACTOR users into engineers (preserving IDs so FKs stay valid)
INSERT INTO "engineers" ("id", "name", "email", "phone", "hourlyRate", "createdAt", "updatedAt")
SELECT "id", "name", "email", NULL, "hourlyRate", "createdAt", "updatedAt"
FROM "users"
WHERE "role" = 'CONTRACTOR';

-- Drop old FK from work_logs pointing to users
ALTER TABLE "work_logs" DROP CONSTRAINT "work_logs_contractorId_fkey";

-- Drop old FKs from _JobContractors pointing to users
ALTER TABLE "_JobContractors" DROP CONSTRAINT "_JobContractors_A_fkey";
ALTER TABLE "_JobContractors" DROP CONSTRAINT "_JobContractors_B_fkey";

-- AddForeignKey: work_logs -> engineers
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "engineers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: _JobContractors -> engineers + jobs
ALTER TABLE "_JobContractors" ADD CONSTRAINT "_JobContractors_A_fkey" FOREIGN KEY ("A") REFERENCES "engineers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_JobContractors" ADD CONSTRAINT "_JobContractors_B_fkey" FOREIGN KEY ("B") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Soft-delete contractor users so they vanish from Team/Users without breaking any remaining FK references
UPDATE "users" SET "deletedAt" = NOW() WHERE "role" = 'CONTRACTOR' AND "deletedAt" IS NULL;
