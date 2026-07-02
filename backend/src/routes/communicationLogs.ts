import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { AuditAction, CommunicationDirection, CommunicationMethod, CommunicationOutcome, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPaginationParams, paginate } from '../lib/utils';
import { emitToJob, emitToAll } from '../lib/socket';
import { logAudit } from '../services/auditService';

const router = Router();
router.use(requireAuth);

// ── GET /api/communication-logs?jobId=<uuid> ──────────────────────────────────
// Returns all communication logs for a job, newest first.

router.get(
  '/',
  [
    query('jobId').isUUID().withMessage('jobId is required and must be a valid UUID.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.query as { jobId: string };
      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      const [logs, total] = await prisma.$transaction([
        prisma.communicationLog.findMany({
          where: { jobId },
          include: {
            performedBy: { select: { id: true, name: true, role: true } },
          },
          orderBy: { loggedAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.communicationLog.count({ where: { jobId } }),
      ]);

      res.json(paginate(logs, total, page, limit));
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/communication-logs ──────────────────────────────────────────────
// Append-only — no updates or deletes on communication logs.
// Every logged communication is a permanent record of a deliberate PM action.
// The system NEVER sends messages automatically; every log entry here means
// a human made contact. (AppFlow.md, Rules.md)

router.post(
  '/',
  requirePermission('communications:create'),
  [
    body('jobId').isUUID().withMessage('jobId is required.'),
    body('direction')
      .isIn(Object.values(CommunicationDirection))
      .withMessage(`direction must be one of: ${Object.values(CommunicationDirection).join(', ')}`),
    body('method')
      .isIn(Object.values(CommunicationMethod))
      .withMessage(`method must be one of: ${Object.values(CommunicationMethod).join(', ')}`),
    body('outcome')
      .isIn(Object.values(CommunicationOutcome))
      .withMessage(`outcome must be one of: ${Object.values(CommunicationOutcome).join(', ')}`),
    body('notes').optional({ nullable: true }).isString().trim(),
    body('loggedAt').optional().isISO8601().toDate()
      .withMessage('loggedAt must be a valid ISO date (defaults to now if omitted).'),
    body('followUp').optional({ nullable: true }),
    body('followUp.dueAt').if(body('followUp').exists({ checkNull: true })).isISO8601().toDate(),
    body('followUp.note').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId, direction, method, outcome, notes, loggedAt, followUp } = req.body as {
        jobId: string;
        direction: CommunicationDirection;
        method: CommunicationMethod;
        outcome: CommunicationOutcome;
        notes?: string | null;
        loggedAt?: Date;
        followUp?: { dueAt: Date; note?: string | null } | null;
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

      const log = await prisma.communicationLog.create({
        data: {
          jobId,
          performedById: req.user!.id,
          direction,
          method,
          outcome,
          notes,
          ...(loggedAt ? { loggedAt } : {}),
        },
        include: {
          performedBy: { select: { id: true, name: true, role: true } },
        },
      });

      await logAudit({
        entityType: 'CommunicationLog',
        entityId: log.id,
        action: AuditAction.CREATE,
        performedById: req.user!.id,
        after: log as any,
        jobId,
      });

      // Create a new follow-up reminder if requested.
      // Reminders are never auto-closed by logging a comm — they close only when the
      // user explicitly presses Mark Done or Dismiss on the timeline or notification center.
      let createdReminder = null;
      if (followUp?.dueAt) {
        createdReminder = await prisma.followUpReminder.create({
          data: {
            jobId,
            createdById: req.user!.id,
            sourceCommunicationLogId: log.id,
            dueAt: followUp.dueAt,
            note: followUp.note ?? null,
          },
        });
        await logAudit({
          entityType: 'FollowUpReminder',
          entityId: createdReminder.id,
          action: AuditAction.CREATE,
          performedById: req.user!.id,
          after: createdReminder as any,
          jobId,
        });
        emitToAll('reminder:changed', { jobId, ts: new Date().toISOString() });
      }

      emitToJob(jobId, 'communicationLog:created', {
        jobId,
        actorId: req.user!.id,
        log,
        ...(createdReminder ? { reminder: createdReminder } : {}),
        ts: new Date().toISOString(),
      });
      res.status(201).json(log);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
