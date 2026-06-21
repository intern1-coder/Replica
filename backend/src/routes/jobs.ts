import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { JobStatus, Role, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { applyTransition, getAllowedTransitions } from '../services/jobStateMachine';
import { getPaginationParams, paginate, formatJobNumber } from '../lib/utils';
import { logAudit } from '../services/auditService';
import logger from '../lib/logger';

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
    query('status').optional().isIn(Object.values(JobStatus)),
    query('clientId').optional().isUUID(),
    query('propertyId').optional().isUUID(),
    query('assignedContractorId').optional().isUUID(),
    query('search').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, clientId, propertyId, assignedContractorId, search } = req.query as {
        status?: JobStatus;
        clientId?: string;
        propertyId?: string;
        assignedContractorId?: string;
        search?: string;
      };

      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      const where: any = { deletedAt: null };
      if (status) where.status = status;
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
          assignedContractors: { select: { id: true, name: true, role: true } },
          generatedDocuments: true,
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
  requireRole(Role.PM, Role.ADMIN),
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
          assignedContractors: { select: { id: true, name: true, role: true } },
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
  requireRole(Role.PM, Role.ADMIN),
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
          assignedContractors: { select: { id: true, name: true, role: true } },
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
  requireRole(Role.PM, Role.ADMIN),
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
      const existing = await prisma.job.findUnique({ where: { id: req.params['id'] } });

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
  requireRole(Role.ADMIN, Role.OWNER),
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
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
