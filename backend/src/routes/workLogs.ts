import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { Role, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { getPaginationParams, paginate } from '../lib/utils';
import { emitWorkLogCreated } from '../lib/socket';
import { logAudit } from '../services/auditService';
import logger from '../lib/logger';

const router = Router();
router.use(requireAuth);

// ── GET /api/work-logs?jobId=<uuid> ───────────────────────────────────────────
// Returns all non-deleted work logs for a job.

router.get(
  '/',
  [
    query('jobId').optional().isUUID().withMessage('jobId must be a valid UUID.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.query as { jobId?: string };
      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      const whereClause = {
        deletedAt: null,
        ...(jobId ? { jobId } : {})
      };

      const [workLogs, total] = await prisma.$transaction([
        prisma.workLog.findMany({
          where: whereClause,
          include: {
            contractor: { select: { id: true, name: true, role: true } },
            loggedBy: { select: { id: true, name: true } },
            job: { select: { id: true, sequence: true, status: true, property: { select: { address: true } } } }
          },
          orderBy: { workDate: 'desc' },
          skip,
          take: limit,
        }),
        prisma.workLog.count({ where: whereClause }),
      ]);

      res.json(paginate(workLogs, total, page, limit));
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/work-logs/:id ────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const workLog = await prisma.workLog.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          contractor: { select: { id: true, name: true, role: true, hourlyRate: true } },
          loggedBy: { select: { id: true, name: true } },
          job: { select: { id: true, sequence: true } },
        },
      });

      if (!workLog) {
        res.status(404).json({ error: 'Not Found', message: 'Work log not found.' });
        return;
      }

      res.json(workLog);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/work-logs ────────────────────────────────────────────────────────
// Creates a work log entry.
// rateApplied is frozen from contractor.hourlyRate at this moment — a later
// rate change MUST NOT silently change past P&L numbers. (Rules.md)

router.post(
  '/',
  requireRole(Role.PM, Role.ADMIN),
  [
    body('jobId').isUUID().withMessage('jobId is required.'),
    body('contractorId').isUUID().withMessage('contractorId is required.'),
    body('hoursWorked')
      .isDecimal({ decimal_digits: '0,2' })
      .withMessage('hoursWorked must be a decimal ≥ 0 with up to 2 decimal places.'),
    body('materialCost')
      .optional({ nullable: true })
      .isDecimal({ decimal_digits: '0,2' })
      .withMessage('materialCost must be a decimal ≥ 0.'),
    body('workDate').isISO8601().toDate().withMessage('workDate must be a valid ISO date.'),
    body('notes').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId, contractorId, hoursWorked, materialCost, workDate, notes } = req.body as {
        jobId: string;
        contractorId: string;
        hoursWorked: string;
        materialCost?: string | null;
        workDate: Date;
        notes?: string | null;
      };

      // Verify job exists
      const job = await prisma.job.findFirst({
        where: { id: jobId, deletedAt: null },
        select: { id: true },
      });
      if (!job) {
        res.status(422).json({ error: 'Unprocessable Entity', message: 'Job not found.' });
        return;
      }

      // Fetch contractor and freeze their current hourly rate
      const contractor = await prisma.user.findFirst({
        where: { id: contractorId, deletedAt: null },
        select: { id: true, hourlyRate: true, name: true },
      });
      if (!contractor) {
        res.status(422).json({ error: 'Unprocessable Entity', message: 'Contractor not found.' });
        return;
      }
      if (!contractor.hourlyRate) {
        res.status(422).json({
          error: 'Unprocessable Entity',
          message: `Contractor "${contractor.name}" has no hourly rate set. Set one before logging time.`,
        });
        return;
      }

      const workLog = await prisma.workLog.create({
        data: {
          jobId,
          contractorId,
          loggedById: req.user!.id,
          hoursWorked,
          rateApplied: contractor.hourlyRate, // ← frozen at log time (Rules.md)
          materialCost: materialCost ?? '0',
          workDate,
          notes,
        },
        include: {
          contractor: { select: { id: true, name: true, role: true } },
          loggedBy: { select: { id: true, name: true } },
        },
      });

      logger.info('Work log created', {
        workLogId: workLog.id,
        jobId,
        contractorId,
        rateApplied: contractor.hourlyRate.toString(),
        loggedById: req.user!.id,
      });

      await logAudit({
        entityType: 'WorkLog',
        entityId: workLog.id,
        action: AuditAction.CREATE,
        performedById: req.user!.id,
        after: workLog as any,
        jobId,
      });

      // Notify connected clients that P&L has changed for this job
      emitWorkLogCreated(jobId);

      res.status(201).json(workLog);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/work-logs/:id ──────────────────────────────────────────────────
// Updates mutable fields only.
// rateApplied and contractorId are NOT patchable — immutable after creation. (Rules.md)

router.patch(
  '/:id',
  requireRole(Role.PM, Role.ADMIN),
  [
    param('id').isUUID(),
    body('hoursWorked')
      .optional()
      .isDecimal({ decimal_digits: '0,2' })
      .withMessage('hoursWorked must be a decimal with up to 2 decimal places.'),
    body('materialCost')
      .optional({ nullable: true })
      .isDecimal({ decimal_digits: '0,2' }),
    body('workDate').optional().isISO8601().toDate(),
    body('notes').optional({ nullable: true }).isString().trim(),
  ],
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
          contractor: { select: { id: true, name: true, role: true } },
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

      emitWorkLogCreated(existing.jobId); // P&L changed — signal consumers to refresh
      res.json(updated);
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
  requireRole(Role.ADMIN, Role.OWNER),
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

      emitWorkLogCreated(existing.jobId); // P&L changed
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
