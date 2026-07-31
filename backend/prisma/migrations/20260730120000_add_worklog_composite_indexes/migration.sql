-- Composite indexes to serve the engineer-hours queries added alongside them:
--   GET /api/work-logs/summary?jobId=&contractorId=  (job-sheet + job footer totals)
--   GET /api/work-logs/summary?contractorId=&startDate=&endDate= (engineer timesheet)
-- The existing single-column indexes on work_logs (jobId), (contractorId),
-- (workDate) don't serve either filter combination efficiently.

-- CreateIndex
CREATE INDEX "work_logs_jobId_contractorId_idx" ON "work_logs"("jobId", "contractorId");

-- CreateIndex
CREATE INDEX "work_logs_contractorId_workDate_idx" ON "work_logs"("contractorId", "workDate");
