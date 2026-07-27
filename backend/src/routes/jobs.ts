import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { JobStatus, Role, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { applyTransition, getAllowedTransitions } from '../services/jobStateMachine';
import { getPaginationParams, paginate, formatJobNumber } from '../lib/utils';
import { logAudit } from '../services/auditService';
import logger from '../lib/logger';
import { emitToAll, emitToJob } from '../lib/socket';

const router = Router();
router.use(requireAuth);

// ── Shared select for job lists ────────────────────────────────────────────────
const JOB_LIST_SELECT = {
  id: true,
  sequence: true,
  status: true,
  version: true,
  propertyId: true,
  property: { select: { id: true, address: true } },
  clientId: true,
  client: { select: { id: true, name: true } },
  tenantId: true,
  tenant: { select: { id: true, name: true, phone: true } },
  tenantSnapshotName: true,
  tenantSnapshotPhone: true,
  quotedValue: true,
  assignedContractors: { select: { id: true, name: true } },
  scheduledDate: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Appends jobNumber (formatted from sequence) to a job object. */
function withJobNumber<T extends { sequence: number }>(job: T) {
  return { ...job, jobNumber: formatJobNumber(job.sequence) };
}

// ── GET /api/jobs ──────────────────────────────────────────────────────────────
// Filtered, paginated job list. Supports status, clientId, propertyId, and
// assignedContractorId filters — matching the primary query patterns from Schema.md.

router.get(
  '/',
  [
    query('tab').optional().isIn(['active', 'completed', 'cancelled', 'archived']),
    query('status').optional().isIn(Object.values(JobStatus)),
    query('clientId').optional().isUUID(),
    query('propertyId').optional().isUUID(),
    query('assignedContractorId').optional().isUUID(),
    query('search').optional().isString().trim(),
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tab, status, clientId, propertyId, assignedContractorId, search, startDate, endDate } = req.query as {
        tab?: 'active' | 'completed' | 'cancelled' | 'archived';
        status?: JobStatus;
        clientId?: string;
        propertyId?: string;
        assignedContractorId?: string;
        search?: string;
        startDate?: Date;
        endDate?: Date;
      };

      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      // "archived" (soft-deleted jobs) is only visible to members who can hard
      // delete — everyone else silently falls back to the Active tab, mirroring
      // clients.ts's includeInactive gating.
      const effectiveTab = tab === 'archived' && !req.user!.can('jobs:delete') ? 'active' : (tab || 'active');

      const where: any = {};
      switch (effectiveTab) {
        case 'completed':
          where.deletedAt = null;
          where.status = JobStatus.COMPLETED;
          break;
        case 'cancelled':
          where.deletedAt = null;
          where.status = JobStatus.CANCELLED;
          break;
        case 'archived':
          where.deletedAt = { not: null };
          break;
        case 'active':
        default:
          where.deletedAt = null;
          where.status = { notIn: [JobStatus.COMPLETED, JobStatus.CANCELLED] };
          break;
      }

      // `status` is a secondary refinement, only meaningful within the Active
      // tab — applying it under Completed/Cancelled/Archived would just
      // contradict the tab's own status/deletedAt clause.
      if (status && effectiveTab === 'active') where.status = status;
      if (clientId) where.clientId = clientId;
      if (propertyId) where.propertyId = propertyId;
      if (assignedContractorId) {
        where.assignedContractors = {
          some: { id: assignedContractorId }
        };
      }
      
      if (search) {
        const searchNum = parseInt(search, 10);
        const orConditions: any[] = [];
        
        if (!isNaN(searchNum)) {
          orConditions.push({ sequence: searchNum });
        }
        
        orConditions.push({ property: { address: { contains: search, mode: 'insensitive' } } });
        orConditions.push({ client: { name: { contains: search, mode: 'insensitive' } } });
        
        where.OR = orConditions;
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) {
          // Push endDate to end-of-day so a same-day range (start == end) is inclusive.
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      const [jobs, total] = await prisma.$transaction([
        prisma.job.findMany({
          where,
          select: JOB_LIST_SELECT,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          skip,
          take: limit,
        }),
        prisma.job.count({ where }),
      ]);

      res.json(paginate(jobs.map(withJobNumber), total, page, limit));
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/jobs/:id ──────────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const job = await prisma.job.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          property: { select: { id: true, address: true, accessNotes: true, keyLocation: true } },
          client: { select: { id: true, name: true, email: true, phone: true } },
          assignedContractors: { select: { id: true, name: true } },
          generatedDocuments: { orderBy: { createdAt: 'desc' } },
        },
      });

      if (!job) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      res.json({
        ...withJobNumber(job),
        allowedTransitions: getAllowedTransitions(job.status),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/jobs ─────────────────────────────────────────────────────────────
// Creates a new job. Captures tenantSnapshotName/Phone from the property's
// current tenant at creation time — these are frozen and never recomputed. (Rules.md)

router.post(
  '/',
  requirePermission('jobs:create'),
  [
    body('propertyId').isUUID().withMessage('propertyId must be a valid UUID.'),
    body('clientId').isUUID().withMessage('clientId must be a valid UUID.'),
    body('description').optional({ nullable: true }).isString().trim(),
    body('quotedValue').optional({ nullable: true }).isDecimal()
      .withMessage('quotedValue must be a decimal number.'),
    body('assignedContractorIds').optional({ nullable: true }).isArray(),
    body('assignedContractorIds.*').optional().isUUID(),
    body('scheduledDate').optional({ nullable: true }).isISO8601().toDate(),
    body('tenantId').optional({ nullable: true }).isUUID(),
    body('newTenantName').optional({ nullable: true }).isString().trim(),
    body('newTenantPhone').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { propertyId, clientId, description, quotedValue, assignedContractorIds, scheduledDate } =
        req.body as {
          propertyId: string;
          clientId: string;
          description?: string | null;
          quotedValue?: string | null;
          assignedContractorIds?: string[] | null;
          scheduledDate?: Date | null;
          tenantId?: string | null;
          newTenantName?: string | null;
          newTenantPhone?: string | null;
        };

      // Load property to snapshot current tenant data
      const property = await prisma.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { id: true },
      });

      if (!property) {
        res.status(422).json({ error: 'Unprocessable Entity', message: 'Property not found or has been deleted.' });
        return;
      }

      // Verify client exists
      const client = await prisma.client.findFirst({
        where: { id: clientId, deletedAt: null },
        select: { id: true },
      });

      if (!client) {
        res.status(422).json({ error: 'Unprocessable Entity', message: 'Client not found or has been deleted.' });
        return;
      }

      let finalTenantId = req.body.tenantId as string | undefined;
      let finalTenantName: string | null = null;
      let finalTenantPhone: string | null = null;

      if (req.body.newTenantName) {
        const t = await prisma.tenant.create({
           data: { 
             name: req.body.newTenantName, 
             phone: req.body.newTenantPhone, 
             lastPropertyId: propertyId, 
             lastClientId: clientId 
           }
        });
        finalTenantId = t.id;
        finalTenantName = t.name;
        finalTenantPhone = t.phone;
      } else if (finalTenantId) {
        const t = await prisma.tenant.update({
           where: { id: finalTenantId },
           data: { lastPropertyId: propertyId, lastClientId: clientId }
        });
        finalTenantName = t.name;
        finalTenantPhone = t.phone;
      }

      const job = await prisma.job.create({
        data: {
          propertyId,
          clientId,
          tenantId: finalTenantId,
          tenantSnapshotName: finalTenantName,
          tenantSnapshotPhone: finalTenantPhone,
          description,
          quotedValue: quotedValue ? quotedValue : undefined,
          assignedContractors: assignedContractorIds && assignedContractorIds.length > 0 
            ? { connect: assignedContractorIds.map((id) => ({ id })) } 
            : undefined,
          scheduledDate,
        },
        include: {
          property: { select: { id: true, address: true } },
          client: { select: { id: true, name: true } },
          tenant: { select: { id: true, name: true, phone: true } },
          assignedContractors: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        entityType: 'Job',
        entityId: job.id,
        action: AuditAction.CREATE,
        performedById: req.user!.id,
        after: job as any,
        jobId: job.id,
      });

      emitToAll('job:created', { jobId: job.id, ts: new Date().toISOString() });

      res.status(201).json({
        ...withJobNumber(job),
        allowedTransitions: getAllowedTransitions(job.status),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/jobs/:id ────────────────────────────────────────────────────────
// Updates mutable fields on a job. Does NOT handle status changes — use
// PATCH /api/jobs/:id/status for that (Rules.md: all status changes through state machine).
// Frozen fields (tenantSnapshot*, status, version) cannot be changed here.

router.patch(
  '/:id',
  requirePermission('jobs:edit'),
  [
    param('id').isUUID(),
    body('description').optional({ nullable: true }).isString().trim(),
    body('diagnosticNotes').optional({ nullable: true }).isString().trim(),
    body('completionNotes').optional({ nullable: true }).isString().trim(),
    body('materials').optional({ nullable: true }).isString().trim(),
    body('quotedValue').optional({ nullable: true }).isDecimal(),
    body('assignedContractorIds').optional({ nullable: true }).isArray(),
    body('assignedContractorIds.*').optional().isUUID(),
    body('scheduledDate').optional({ nullable: true }).isISO8601().toDate(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.job.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          property: { select: { id: true, address: true } },
          client: { select: { id: true, name: true } },
          assignedContractors: { select: { id: true, name: true } },
        },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      const { description, diagnosticNotes, completionNotes, materials, quotedValue, assignedContractorIds, scheduledDate } =
        req.body as {
          description?: string | null;
          diagnosticNotes?: string | null;
          completionNotes?: string | null;
          materials?: string | null;
          quotedValue?: string | null;
          assignedContractorIds?: string[] | null;
          scheduledDate?: Date | null;
        };

      const updated = await prisma.job.update({
        where: { id: req.params['id'] },
        data: {
          description,
          diagnosticNotes,
          completionNotes,
          materials,
          quotedValue: quotedValue !== undefined ? quotedValue : undefined,
          assignedContractors: assignedContractorIds ? { set: assignedContractorIds.map((id) => ({ id })) } : undefined,
          scheduledDate,
        },
        include: {
          property: { select: { id: true, address: true } },
          client: { select: { id: true, name: true } },
          assignedContractors: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        entityType: 'Job',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        performedById: req.user!.id,
        before: existing as any,
        after: updated as any,
        jobId: updated.id,
      });

      emitToJob(updated.id, 'job:updated', {
        jobId: updated.id,
        actorId: req.user!.id,
        job: {
          description: updated.description,
          diagnosticNotes: updated.diagnosticNotes,
          completionNotes: updated.completionNotes,
          materials: updated.materials,
          quotedValue: updated.quotedValue,
          scheduledDate: updated.scheduledDate,
          assignedContractors: updated.assignedContractors,
          version: updated.version,
          updatedAt: updated.updatedAt,
        },
        ts: new Date().toISOString(),
      });

      res.json({
        ...withJobNumber(updated),
        allowedTransitions: getAllowedTransitions(updated.status),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/jobs/:id/status ─────────────────────────────────────────────────
// Applies a state-machine transition. Requires the client to send the current
// `version` for optimistic locking — if another session modified the job first,
// this returns 409 { type: 'OPTIMISTIC_LOCK_CONFLICT' } so the frontend can
// prompt a refresh (Rules.md).

router.patch(
  '/:id/status',
  // jobs:edit covers normal transitions; jobs:complete alone (e.g. ACCOUNTS,
  // who are otherwise read-only) permits only the final → COMPLETED sign-off.
  // The state machine re-validates the COMPLETED permission itself.
  (req: Request, res: Response, next: NextFunction): void => {
    const wantsComplete = req.body?.status === JobStatus.COMPLETED;
    if (req.user!.can('jobs:edit') || (wantsComplete && req.user!.can('jobs:complete'))) {
      next();
      return;
    }
    res.status(403).json({
      error: 'Forbidden',
      message: 'You do not have permission to perform this action.',
    });
  },
  [
    param('id').isUUID(),
    body('status')
      .isIn(Object.values(JobStatus))
      .withMessage(`status must be one of: ${Object.values(JobStatus).join(', ')}`),
    body('version')
      .isInt({ min: 0 })
      .withMessage('version must be a non-negative integer.'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, version } = req.body as { status: JobStatus; version: number };
      const existing = await prisma.job.findUnique({
        where: { id: req.params['id'] },
        include: {
          property: { select: { id: true, address: true } },
          client: { select: { id: true, name: true } },
          assignedContractors: { select: { id: true, name: true } },
        },
      });

      const updatedJob = await applyTransition({
        jobId: req.params['id'],
        currentVersion: version,
        toStatus: status,
        performedById: req.user!.id,
      });

      await logAudit({
        entityType: 'Job',
        entityId: updatedJob.id,
        action: AuditAction.UPDATE,
        performedById: req.user!.id,
        before: existing as any,
        after: updatedJob as any,
        jobId: updatedJob.id,
      });

      res.json({
        ...withJobNumber(updatedJob),
        allowedTransitions: getAllowedTransitions(updatedJob.status),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/jobs/:id (soft delete) ────────────────────────────────────────

router.delete(
  '/:id',
  requirePermission('jobs:delete'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.job.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      await prisma.job.update({
        where: { id: req.params['id'] },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        entityType: 'Job',
        entityId: req.params['id'],
        action: AuditAction.DELETE,
        performedById: req.user!.id,
        before: existing as any,
        jobId: existing.id,
      });

      logger.info('Job deleted', { jobId: req.params['id'], deletedById: req.user!.id });
      emitToAll('job:deleted', { jobId: req.params['id'], ts: new Date().toISOString() });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/jobs/:id/restore ─────────────────────────────────────────────────
// Reactivates a soft-deleted (archived) job. Same permission as deletion.

router.patch(
  '/:id/restore',
  requirePermission('jobs:delete'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.job.findFirst({
        where: { id: req.params['id'], deletedAt: { not: null } },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Archived job not found.' });
        return;
      }

      const updated = await prisma.job.update({
        where: { id: req.params['id'] },
        data: { deletedAt: null },
      });

      await logAudit({
        entityType: 'Job',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        performedById: req.user!.id,
        before: existing as any,
        after: updated as any,
        jobId: updated.id,
      });

      logger.info('Job restored', { jobId: updated.id, restoredById: req.user!.id });
      emitToAll('job:created', { jobId: updated.id, ts: new Date().toISOString() });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
