import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { Role, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPaginationParams, paginate } from '../lib/utils';
import { emitToJob } from '../lib/socket';
import { logAudit } from '../services/auditService';
import logger from '../lib/logger';
import { summariseWorkLogs } from '../services/workLogSummary';

const router = Router();
router.use(requireAuth);

// rateApplied (and the engineer's own hourlyRate nested under `contractor`) is
// derived-from-rate money, gated behind engineer_costs:view — the same key
// that gates it on GET /api/engineers. The key is omitted entirely (not sent
// as null) so the frontend can tell "no rate set" apart from "hidden from you".
function stripRateFields<T extends { contractor?: any; rateApplied?: any }>(
  workLog: T,
  canSeeRates: boolean
): T {
  if (canSeeRates) return workLog;
  const { rateApplied, ...rest } = workLog as any;
  if (rest.contractor) {
    const { hourlyRate, ...contractorRest } = rest.contractor;
    rest.contractor = contractorRest;
  }
  return rest;
}

// ── GET /api/work-logs?jobId=<uuid> ───────────────────────────────────────────
// Returns all non-deleted work logs for a job.

router.get(
  '/',
  requirePermission('worklogs:view'),
  [
    query('jobId').optional().isUUID().withMessage('jobId must be a valid UUID.'),
    query('contractorId').optional().isUUID().withMessage('contractorId must be a valid UUID.'),
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId, contractorId, startDate, endDate } = req.query as { 
        jobId?: string;
        contractorId?: string;
        startDate?: Date;
        endDate?: Date;
      };
      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      const whereClause: any = {
        deletedAt: null,
      };
      
      if (jobId) whereClause.jobId = jobId;
      if (contractorId) whereClause.contractorId = contractorId;
      
      if (startDate || endDate) {
        whereClause.workDate = {};
        if (startDate) whereClause.workDate.gte = startDate;
        if (endDate) whereClause.workDate.lte = endDate;
      }

      const [workLogs, total] = await prisma.$transaction([
        prisma.workLog.findMany({
          where: whereClause,
          include: {
            contractor: { select: { id: true, name: true } },
            loggedBy: { select: { id: true, name: true } },
            receipts: {
              where: { deletedAt: null },
              select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
            },
            job: {
              select: { 
                id: true, 
                sequence: true, 
                status: true, 
                description: true,
                property: { select: { address: true, accessNotes: true } } 
              } 
            }
          },
          orderBy: { workDate: 'desc' },
          skip,
          take: limit,
        }),
        prisma.workLog.count({ where: whereClause }),
      ]);

      const canSeeRates = req.user!.can('engineer_costs:view');
      res.json(paginate(workLogs.map((w) => stripRateFields(w, canSeeRates)), total, page, limit));
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/work-logs/summary?jobId=&contractorId=&startDate=&endDate= ──────
// Aggregated hours/cost totals for a job or an engineer — the server-side
// source of truth for "how many hours has X logged", used by the job page
// footer, the engineer timesheet view, and the Job Sheet PDF, so none of
// them can silently disagree with each other or with a partially-loaded page.
//
// Registered BEFORE GET /:id — Express matches routes in declaration order,
// and "summary" would otherwise be swallowed by the :id route and fail
// its isUUID validator.

router.get(
  '/summary',
  requirePermission('worklogs:view'),
  [
    query('jobId').optional().isUUID().withMessage('jobId must be a valid UUID.'),
    query('contractorId').optional().isUUID().withMessage('contractorId must be a valid UUID.'),
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId, contractorId, startDate, endDate } = req.query as {
        jobId?: string;
        contractorId?: string;
        startDate?: Date;
        endDate?: Date;
      };

      if (!jobId && !contractorId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'jobId or contractorId is required.',
        });
        return;
      }

      const where: any = { deletedAt: null };
      if (jobId) where.jobId = jobId;
      if (contractorId) where.contractorId = contractorId;
      if (startDate || endDate) {
        where.workDate = {};
        if (startDate) where.workDate.gte = startDate;
        if (endDate) where.workDate.lte = endDate;
      }

      const logs = await prisma.workLog.findMany({
        where,
        select: { contractorId: true, hoursWorked: true, rateApplied: true, materialCost: true },
      });

      const summary = summariseWorkLogs(logs);

      // labourCost is derived from the engineer's rate — gate it the same way
      // the rate itself is gated. materialCost is ordinary job cost entered by
      // the PM, not engineer rate data, so it stays visible to worklogs:view.
      const canSeeRates = req.user!.can('engineer_costs:view');

      const contractorIds = summary.byContractor.map((c) => c.contractorId);
      const engineers = contractorIds.length
        ? await prisma.engineer.findMany({
            where: { id: { in: contractorIds } },
            select: { id: true, name: true },
          })
        : [];
      const namesById = new Map(engineers.map((e) => [e.id, e.name]));

      res.json({
        totals: {
          hours: summary.totals.hours,
          materialCost: summary.totals.materialCost,
          logCount: summary.totals.logCount,
          ...(canSeeRates ? { labourCost: summary.totals.labourCost } : {}),
        },
        byContractor: summary.byContractor.map((c) => ({
          contractorId: c.contractorId,
          name: namesById.get(c.contractorId) ?? 'Unknown',
          hours: c.hours,
          materialCost: c.materialCost,
          logCount: c.logCount,
          ...(canSeeRates ? { labourCost: c.labourCost } : {}),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/work-logs/:id ────────────────────────────────────────────────────

router.get(
  '/:id',
  requirePermission('worklogs:view'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workLog = await prisma.workLog.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          contractor: { select: { id: true, name: true, hourlyRate: true } },
          loggedBy: { select: { id: true, name: true } },
          job: { select: { id: true, sequence: true } },
        },
      });

      if (!workLog) {
        res.status(404).json({ error: 'Not Found', message: 'Work log not found.' });
        return;
      }

      res.json(stripRateFields(workLog, req.user!.can('engineer_costs:view')));
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/work-logs ────────────────────────────────────────────────────────
// Creates a work log entry.
// rateApplied is frozen at this moment from rateApplied/hourlyRate (body) or
// the engineer's current default — a later rate change MUST NOT silently
// change past P&L numbers (Rules.md). The engineer's own default rate is
// never touched unless updateEngineerDefaultRate is explicitly set.
//
// Logging hours for an engineer not yet on this job's assignment list
// auto-assigns them (in the same transaction as the log) — assignment and
// hours must never drift apart.

router.post(
  '/',
  requirePermission('worklogs:create'),
  [
    body('jobId').isUUID().withMessage('jobId is required.'),
    body('contractorId').isUUID().withMessage('contractorId is required.'),
    body('hoursWorked')
      .isDecimal({ decimal_digits: '0,2' }).bail()
      .isFloat({ gt: 0, max: 24 })
      .withMessage('hoursWorked must be greater than 0 and at most 24, with up to 2 decimal places.'),
    body('materialCost')
      .optional({ nullable: true })
      .isDecimal({ decimal_digits: '0,2' }).bail()
      .isFloat({ min: 0 })
      .withMessage('materialCost must be a decimal ≥ 0.'),
    body('rateApplied')
      .optional({ nullable: true })
      .isDecimal({ decimal_digits: '0,2' }).bail()
      .isFloat({ min: 0, max: 10000 })
      .withMessage('rateApplied must be a decimal between 0 and 10000.'),
    // Deprecated alias for rateApplied — accepted so existing frontend builds
    // keep working during rollout. rateApplied wins if both are sent.
    body('hourlyRate')
      .optional({ nullable: true })
      .isDecimal({ decimal_digits: '0,2' }).bail()
      .isFloat({ min: 0, max: 10000 })
      .withMessage('hourlyRate must be a decimal between 0 and 10000.'),
    body('updateEngineerDefaultRate').optional().isBoolean().toBoolean(),
    body('workDate').isISO8601().toDate().withMessage('workDate must be a valid ISO date.'),
    body('notes').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        jobId,
        contractorId,
        hoursWorked,
        materialCost,
        rateApplied: providedRateApplied,
        hourlyRate: providedHourlyRate,
        updateEngineerDefaultRate,
        workDate,
        notes,
      } = req.body as {
        jobId: string;
        contractorId: string;
        hoursWorked: string;
        materialCost?: string | null;
        rateApplied?: string | null;
        hourlyRate?: string | null;
        updateEngineerDefaultRate?: boolean;
        workDate: Date;
        notes?: string | null;
      };

      const requestedRate: string | null =
        providedRateApplied !== undefined && providedRateApplied !== null
          ? providedRateApplied
          : providedHourlyRate !== undefined && providedHourlyRate !== null
          ? providedHourlyRate
          : null;

      const { workLog, autoAssigned, rateUpdate } = await prisma.$transaction(async (tx) => {
        const job = await tx.job.findFirst({
          where: { id: jobId, deletedAt: null },
          select: { assignedContractors: { where: { deletedAt: null }, select: { id: true } } },
        });
        if (!job) {
          throw Object.assign(new Error('Job not found.'), { status: 422, error: 'Unprocessable Entity' });
        }

        const contractor = await tx.engineer.findFirst({
          where: { id: contractorId, deletedAt: null },
          select: { id: true, hourlyRate: true, name: true },
        });
        if (!contractor) {
          throw Object.assign(new Error('Engineer not found.'), { status: 422, error: 'Unprocessable Entity' });
        }

        // rateApplied is frozen onto the log — resolve it from the request,
        // falling back to the engineer's current default. NEVER write back to
        // the engineer's record unless updateEngineerDefaultRate is explicit.
        const rateApplied: string | null =
          requestedRate ?? (contractor.hourlyRate !== null ? contractor.hourlyRate.toString() : null);
        if (rateApplied === null) {
          throw Object.assign(
            new Error(`${contractor.name} has no default rate. Enter a rate for this log.`),
            { status: 422, error: 'Unprocessable Entity' }
          );
        }

        let rateUpdate: { before: string | null; after: string } | null = null;
        if (updateEngineerDefaultRate && requestedRate !== null) {
          await tx.engineer.update({ where: { id: contractorId }, data: { hourlyRate: requestedRate } });
          rateUpdate = {
            before: contractor.hourlyRate !== null ? contractor.hourlyRate.toString() : null,
            after: requestedRate,
          };
        }

        const autoAssigned = !job.assignedContractors.some((c) => c.id === contractorId);
        if (autoAssigned) {
          await tx.job.update({
            where: { id: jobId },
            data: { assignedContractors: { connect: { id: contractorId } } },
          });
        }

        const workLog = await tx.workLog.create({
          data: {
            jobId,
            contractorId,
            loggedById: req.user!.id,
            hoursWorked,
            rateApplied,
            materialCost: materialCost ?? '0',
            workDate,
            notes,
          },
          include: {
            contractor: { select: { id: true, name: true } },
            loggedBy: { select: { id: true, name: true } },
          },
        });

        return { workLog, autoAssigned, rateUpdate };
      });

      logger.info('Work log created', {
        workLogId: workLog.id,
        jobId,
        contractorId,
        rateApplied: workLog.rateApplied.toString(),
        loggedById: req.user!.id,
        autoAssigned,
      });

      await logAudit({
        entityType: 'WorkLog',
        entityId: workLog.id,
        action: AuditAction.CREATE,
        performedById: req.user!.id,
        after: workLog as any,
        jobId,
      });

      if (rateUpdate) {
        await logAudit({
          entityType: 'Engineer',
          entityId: contractorId,
          action: AuditAction.UPDATE,
          performedById: req.user!.id,
          before: { hourlyRate: rateUpdate.before },
          after: { hourlyRate: rateUpdate.after },
        });
      }

      let updatedContractors: { id: string; name: string }[] | undefined;
      if (autoAssigned) {
        await logAudit({
          entityType: 'Job',
          entityId: jobId,
          action: AuditAction.UPDATE,
          performedById: req.user!.id,
          before: { assignedContractors: 'engineer not yet assigned' },
          after: { assignedContractors: `+${workLog.contractor?.name ?? contractorId}` },
          jobId,
        });

        const refreshedJob = await prisma.job.findUnique({
          where: { id: jobId },
          select: { assignedContractors: { where: { deletedAt: null }, select: { id: true, name: true } } },
        });
        updatedContractors = refreshedJob?.assignedContractors;

        emitToJob(jobId, 'job:updated', {
          jobId,
          actorId: req.user!.id,
          job: { assignedContractors: updatedContractors ?? [] },
          ts: new Date().toISOString(),
        });
      }

      // Notify connected clients that P&L has changed for this job
      emitToJob(jobId, 'workLog:created', {
        jobId,
        actorId: req.user!.id,
        workLog,
        ts: new Date().toISOString(),
      });

      res.status(201).json({ ...stripRateFields(workLog, req.user!.can('engineer_costs:view')), autoAssigned });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/work-logs/:id ──────────────────────────────────────────────────
// Updates mutable fields only.
// rateApplied and contractorId are NOT patchable — immutable after creation
// (Rules.md). To correct a rate, delete this log and re-add it; both actions
// are audit-logged, so the trail is preserved.

router.patch(
  '/:id',
  requirePermission('worklogs:edit'),
  [
    param('id').isUUID(),
    body('hoursWorked')
      .optional()
      .isDecimal({ decimal_digits: '0,2' }).bail()
      .isFloat({ gt: 0, max: 24 })
      .withMessage('hoursWorked must be greater than 0 and at most 24, with up to 2 decimal places.'),
    body('rateApplied')
      .not().exists()
      .withMessage('rateApplied is frozen at log time. Delete this log and re-add it to correct the rate.'),
    body('materialCost')
      .optional({ nullable: true })
      .isDecimal({ decimal_digits: '0,2' }).bail()
      .isFloat({ min: 0 })
      .withMessage('materialCost must be a decimal ≥ 0.'),
    body('workDate').optional().isISO8601().toDate(),
    body('notes').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.workLog.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          contractor: { select: { id: true, name: true } },
          loggedBy: { select: { id: true, name: true } },
        },
      });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Work log not found.' });
        return;
      }

      const { hoursWorked, materialCost, workDate, notes } = req.body as {
        hoursWorked?: string;
        materialCost?: string | null;
        workDate?: Date;
        notes?: string | null;
      };

      const updated = await prisma.workLog.update({
        where: { id: req.params['id'] },
        data: {
          hoursWorked,
          // Decimal fields don't accept null — null means "don't change this field"
          materialCost: materialCost !== null ? materialCost : undefined,
          workDate,
          notes,
        },
        include: {
          contractor: { select: { id: true, name: true } },
          loggedBy: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        entityType: 'WorkLog',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        performedById: req.user!.id,
        before: existing as any,
        after: updated as any,
        jobId: updated.jobId,
      });

      emitToJob(existing.jobId, 'workLog:created', { jobId: existing.jobId, actorId: req.user!.id, ts: new Date().toISOString() }); // P&L changed — signal consumers to refresh
      res.json(stripRateFields(updated, req.user!.can('engineer_costs:view')));
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/work-logs/:id (soft delete) ───────────────────────────────────
// Soft-deletes the work log. The P&L raw SQL filters deleted rows via
// `w.deleted_at IS NULL` so they disappear from totals immediately.

router.delete(
  '/:id',
  requirePermission('worklogs:delete'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.workLog.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Work log not found.' });
        return;
      }

      await prisma.workLog.update({
        where: { id: req.params['id'] },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        entityType: 'WorkLog',
        entityId: req.params['id'],
        action: AuditAction.DELETE,
        performedById: req.user!.id,
        before: existing as any,
        jobId: existing.jobId,
      });

      emitToJob(existing.jobId, 'workLog:created', { jobId: existing.jobId, actorId: req.user!.id, ts: new Date().toISOString() }); // P&L changed
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
