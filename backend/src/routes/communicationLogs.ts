import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { CommunicationDirection, CommunicationMethod, CommunicationOutcome, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { getPaginationParams, paginate } from '../lib/utils';
import { emitCommunicationLogged } from '../lib/socket';

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
  requireRole(Role.PM, Role.ADMIN),
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
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId, direction, method, outcome, notes, loggedAt } = req.body as {
        jobId: string;
        direction: CommunicationDirection;
        method: CommunicationMethod;
        outcome: CommunicationOutcome;
        notes?: string | null;
        loggedAt?: Date;
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

      emitCommunicationLogged(jobId);
      res.status(201).json(log);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
