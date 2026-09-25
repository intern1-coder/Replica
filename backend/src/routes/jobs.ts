import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { JobStatus, Role, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate, OptimisticLockError } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { applyTransition, getAllowedTransitions } from '../services/jobStateMachine';
import { getPaginationParams, paginate, formatJobNumber } from '../lib/utils';
import { logAudit } from '../services/auditService';
import logger from '../lib/logger';
import { emitToAll, emitToJob } from '../lib/socket';
import { ACTIVE_ASSIGNED_CONTRACTORS } from '../lib/prismaSelects';

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
  assignedContractors: ACTIVE_ASSIGNED_CONTRACTORS,
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
  requirePermission('jobs:view'),
  [
    query('tab').optional().isIn(['active', 'completed', 'cancelled', 'archived']),
    query('status').optional().isIn(Object.values(JobStatus)),
    query('clientId').optional().isUUID(),
    query('propertyId').optional().isUUID(),
    query('assignedContractorId').optional().isUUID(),
    query('search').optional().isString().trim(),
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
    // Filters on Job.scheduledDate (the booked work date) — distinct from
    // startDate/endDate above, which filter createdAt. Used by the Logistics
    // tab's "Upcoming" view to find jobs booked in a future window.
    query('scheduledFrom').optional().isISO8601().toDate(),
    query('scheduledTo').optional().isISO8601().toDate(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tab, status, clientId, propertyId, assignedContractorId, search, startDate, endDate, scheduledFrom, scheduledTo } = req.query as {
        tab?: 'active' | 'completed' | 'cancelled' | 'archived';
        status?: JobStatus;
        clientId?: string;
        propertyId?: string;
        assignedContractorId?: string;
        search?: string;
        startDate?: Date;
        endDate?: Date;
        scheduledFrom?: Date;
        scheduledTo?: Date;
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

      if (scheduledFrom || scheduledTo) {
        where.scheduledDate = { not: null };
        if (scheduledFrom) where.scheduledDate.gte = scheduledFrom;
        if (scheduledTo) {
          const end = new Date(scheduledTo);
          end.setHours(23, 59, 59, 999);
          where.scheduledDate.lte = end;
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

// ── GET /api/jobs/counts ──────────────────────────────────────────────────────
// Aggregated pipeline counts for the Jobs page chips/tabs and the Dashboard
// breakdown: per-status totals, tab totals, stalled active jobs (no update in
// STALLED_DAYS+ days — any status change bumps updatedAt, so these have held
// their status at least that long) and 7-day flow (transitions into each
// status, diffed from Job UPDATE audit snapshots). Registered before GET /:id
// so Express doesn't match "counts" as an id.
const STALLED_DAYS = 5;
const FLOW_WINDOW_DAYS = 7;

function zeroFilledCounts(): Record<string, number> {
  return Object.fromEntries(Object.values(JobStatus).map((s) => [s, 0]));
}

router.get(
  '/counts',
  requirePermission('jobs:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const now = Date.now();
      const flowSince = new Date(now - FLOW_WINDOW_DAYS * 86400000);
      const stalledBefore = new Date(now - STALLED_DAYS * 86400000);

      // Single lightweight scan (status/updatedAt/deletedAt only) + audit
      // window — cheaper and type-safer than Prisma groupBy aggregates.
      const [rows, recentUpdates] = await prisma.$transaction([
        prisma.job.findMany({
          select: { status: true, updatedAt: true, deletedAt: true },
        }),
        prisma.auditLog.findMany({
          where: {
            entityType: 'Job',
            action: AuditAction.UPDATE,
            jobId: { not: null },
            createdAt: { gte: flowSince },
          },
          select: { before: true, after: true },
        }),
      ]);

      const byStatus = zeroFilledCounts();
      const stalled = zeroFilledCounts();
      let archivedCount = 0;
      const activeStatuses = new Set<JobStatus>(
        Object.values(JobStatus).filter(
          (s) => s !== JobStatus.COMPLETED && s !== JobStatus.CANCELLED
        )
      );

      for (const row of rows) {
        if (row.deletedAt) {
          archivedCount += 1;
          continue;
        }
        byStatus[row.status] += 1;
        // Any status change bumps updatedAt, so a stale timestamp means the
        // job has held this status (untouched) for at least STALLED_DAYS.
        if (activeStatuses.has(row.status) && row.updatedAt < stalledBefore) {
          stalled[row.status] += 1;
        }
      }

      // Flow = transitions INTO a status (after.status), diffed from audit
      // snapshots — other job UPDATEs have identical before/after status.
      const flow7d = zeroFilledCounts();
      for (const row of recentUpdates) {
        const before = row.before as { status?: string } | null;
        const after = row.after as { status?: string } | null;
        if (
          before?.status &&
          after?.status &&
          before.status !== after.status &&
          after.status in byStatus
        ) {
          flow7d[after.status] += 1;
        }
      }

      const activeCount = Object.values(JobStatus)
        .filter((s) => s !== JobStatus.COMPLETED && s !== JobStatus.CANCELLED)
        .reduce((sum, s) => sum + byStatus[s], 0);

      res.json({
        byStatus,
        byTab: {
          active: activeCount,
          completed: byStatus[JobStatus.COMPLETED],
          cancelled: byStatus[JobStatus.CANCELLED],
          // Same gate as the Archived tab — hide existence from users without delete.
          archived: req.user!.can('jobs:delete') ? archivedCount : 0,
        },
        stalled,
        flow7d,
        stalledDays: STALLED_DAYS,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/jobs/:id ──────────────────────────────────────────────────────────

router.get(
  '/:id',
  requirePermission('jobs:view'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const job = await prisma.job.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          property: { select: { id: true, address: true, accessNotes: true, keyLocation: true } },
          client: { select: { id: true, name: true, email: true, phone: true } },
          tenant: { select: { id: true, name: true, phone: true, email: true } },
          assignedContractors: ACTIVE_ASSIGNED_CONTRACTORS,
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
          assignedContractors: ACTIVE_ASSIGNED_CONTRACTORS,
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
//
// Requires the caller's last-known `version` for optimistic locking, the same
// pattern PATCH /:id/status already uses via jobStateMachine.ts — without
// this, two PMs editing the same job's description/materials/quotedValue at
// once silently overwrite each other with no warning (Rules.md).

router.patch(
  '/:id',
  requirePermission('jobs:edit'),
  [
    param('id').isUUID(),
    body('version').isInt({ min: 0 }).withMessage('version is required for optimistic locking.').toInt(),
    body('description').optional({ nullable: true }).isString().trim(),
    body('diagnosticNotes').optional({ nullable: true }).isString().trim(),
    body('completionNotes').optional({ nullable: true }).isString().trim(),
    body('materials').optional({ nullable: true }).isString().trim(),
    body('quotedValue').optional({ nullable: true }).isDecimal(),
    body('assignedContractorIds').optional({ nullable: true }).isArray(),
    body('assignedContractorIds.*').optional().isUUID(),
    body('scheduledDate').optional({ nullable: true }).isISO8601().toDate(),
    // Snapshot fields are normally frozen at creation and never recomputed
    // (Rules.md) — this scoped exception lets an operator refresh this one
    // job's copy after correcting a typo on the underlying Tenant record.
    body('tenantSnapshotName').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
    body('tenantSnapshotPhone').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.job.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          property: { select: { id: true, address: true } },
          client: { select: { id: true, name: true } },
          assignedContractors: ACTIVE_ASSIGNED_CONTRACTORS,
        },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      const {
        version,
        description,
        diagnosticNotes,
        completionNotes,
        materials,
        quotedValue,
        assignedContractorIds,
        scheduledDate,
        tenantSnapshotName,
        tenantSnapshotPhone,
      } = req.body as {
        version: number;
        description?: string | null;
        diagnosticNotes?: string | null;
        completionNotes?: string | null;
        materials?: string | null;
        quotedValue?: string | null;
        assignedContractorIds?: string[] | null;
        scheduledDate?: Date | null;
        tenantSnapshotName?: string | null;
        tenantSnapshotPhone?: string | null;
      };

      // assignedContractorIds is diffed (connect/disconnect) rather than
      // {set:} so concurrent edits from two sessions are additive, not
      // last-write-wins. Unassigning an engineer who has hours on this job
      // is blocked — the assignment list and the hours must never drift apart.
      let assignedContractorsUpdate: { connect: { id: string }[]; disconnect: { id: string }[] } | undefined;

      if (assignedContractorIds) {
        const nextIds = [...new Set(assignedContractorIds)];
        const existingIds = existing.assignedContractors.map((c) => c.id);
        const added = nextIds.filter((id) => !existingIds.includes(id));
        const removed = existingIds.filter((id) => !nextIds.includes(id));

        if (removed.length > 0) {
          const blocked = await prisma.workLog.groupBy({
            by: ['contractorId'],
            where: { jobId: existing.id, deletedAt: null, contractorId: { in: removed } },
          });
          if (blocked.length > 0) {
            const blockedIds = new Set(blocked.map((b) => b.contractorId));
            const blockedNames = existing.assignedContractors
              .filter((c) => blockedIds.has(c.id))
              .map((c) => c.name);
            res.status(422).json({
              error: 'Unprocessable Entity',
              message: `Cannot unassign ${blockedNames.join(', ')} — they have logged hours on this job.`,
            });
            return;
          }
        }

        if (added.length > 0) {
          const liveCount = await prisma.engineer.count({ where: { id: { in: added }, deletedAt: null } });
          if (liveCount !== added.length) {
            res.status(422).json({ error: 'Unprocessable Entity', message: 'One or more selected engineers could not be found.' });
            return;
          }
        }

        assignedContractorsUpdate = {
          connect: added.map((id) => ({ id })),
          disconnect: removed.map((id) => ({ id })),
        };
      }

      const jobId = req.params['id'];

      // updateMany (not update) so the WHERE clause can include `version` —
      // this is the atomic compare-and-swap: it only matches (and only then
      // increments version) if the caller's version is still current. Relation
      // writes (connect/disconnect) aren't supported on updateMany, so those
      // apply as a second write inside the same transaction, gated on the
      // first one having actually matched a row.
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.job.updateMany({
          where: { id: jobId, version, deletedAt: null },
          data: {
            description,
            diagnosticNotes,
            completionNotes,
            materials,
            quotedValue: quotedValue !== undefined ? quotedValue : undefined,
            scheduledDate,
            tenantSnapshotName,
            tenantSnapshotPhone,
            version: { increment: 1 },
          },
        });

        if (result.count === 0) {
          const lockErr = Object.assign(new Error('Concurrent modification detected.'), {
            type: 'OPTIMISTIC_LOCK_CONFLICT' as const,
            id: jobId,
          }) as OptimisticLockError;
          throw lockErr;
        }

        if (assignedContractorsUpdate) {
          await tx.job.update({
            where: { id: jobId },
            data: { assignedContractors: assignedContractorsUpdate },
          });
        }

        return tx.job.findUniqueOrThrow({
          where: { id: jobId },
          include: {
            property: { select: { id: true, address: true } },
            client: { select: { id: true, name: true } },
            assignedContractors: ACTIVE_ASSIGNED_CONTRACTORS,
          },
        });
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
          tenantSnapshotName: updated.tenantSnapshotName,
          tenantSnapshotPhone: updated.tenantSnapshotPhone,
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
          assignedContractors: ACTIVE_ASSIGNED_CONTRACTORS,
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
//
// A job archived while CANCELLED ("Not Proceeding") is ambiguous on restore:
// the caller may want it back in Not Proceeding, or reactivated into the
// active pipeline. `reactivate: true` requests the latter — we reconstruct
// the status it held right before cancellation from the audit trail (the
// only record of it, since the job row itself only keeps the current
// status), falling back to TO_BE_CHECKED if that entry can't be found.

router.patch(
  '/:id/restore',
  requirePermission('jobs:delete'),
  [param('id').isUUID(), body('reactivate').optional().isBoolean().toBoolean()],
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

      const reactivate = req.body.reactivate === true;
      const data: { deletedAt: null; status?: JobStatus } = { deletedAt: null };

      if (reactivate && existing.status === JobStatus.CANCELLED) {
        const lastCancellation = await prisma.auditLog.findFirst({
          where: {
            entityType: 'Job',
            entityId: existing.id,
            action: AuditAction.UPDATE,
            after: { path: ['status'], equals: JobStatus.CANCELLED },
          },
          orderBy: { createdAt: 'desc' },
        });
        const priorStatus = (lastCancellation?.before as { status?: string } | null)?.status;
        data.status = priorStatus && priorStatus in JobStatus
          ? (priorStatus as JobStatus)
          : JobStatus.TO_BE_CHECKED;
      }

      const updated = await prisma.job.update({
        where: { id: req.params['id'] },
        data,
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

      logger.info('Job restored', { jobId: updated.id, restoredById: req.user!.id, reactivated: reactivate, status: updated.status });
      emitToAll('job:created', { jobId: updated.id, ts: new Date().toISOString() });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
