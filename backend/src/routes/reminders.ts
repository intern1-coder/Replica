import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { AuditAction, Role, ReminderStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { emitReminderChanged } from '../lib/socket';
import { logAudit } from '../services/auditService';

const router = Router();
router.use(requireAuth);

// ── GET /api/reminders?status=OPEN[&jobId=<uuid>] ─────────────────────────────
router.get(
  '/',
  [
    query('status').optional().isIn(Object.values(ReminderStatus)),
    query('jobId').optional().isUUID(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status, jobId } = req.query as { status?: ReminderStatus; jobId?: string };

      const reminders = await prisma.followUpReminder.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(jobId ? { jobId } : {}),
        },
        include: {
          job: { select: { id: true, sequence: true, property: { select: { address: true } } } },
          createdBy: { select: { id: true, name: true } },
          resolvedBy: { select: { id: true, name: true } },
        },
        orderBy: { dueAt: 'asc' },
        take: 100,
      });

      res.json(reminders);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/reminders/:id ─────────────────────────────────────────────────
// action: "snooze" | "done" | "dismiss"
router.patch(
  '/:id',
  requirePermission('reminders:manage'),
  [
    param('id').isUUID(),
    body('action').isIn(['snooze', 'done', 'dismiss']).withMessage('action must be snooze, done, or dismiss'),
    body('snoozeMinutes').optional().isInt({ min: 1 }).toInt(),
    body('closingNote').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const { action, snoozeMinutes = 1440, closingNote } = req.body as {
        action: 'snooze' | 'done' | 'dismiss';
        snoozeMinutes?: number;
        closingNote?: string | null;
      };

      const existing = await prisma.followUpReminder.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Reminder not found.' });
        return;
      }

      let updated;
      if (action === 'snooze') {
        const newDueAt = new Date(Date.now() + snoozeMinutes * 60 * 1000);
        updated = await prisma.followUpReminder.update({
          where: { id },
          data: { dueAt: newDueAt, notifiedAt: null },
        });
      } else {
        const defaultReason = action === 'done' ? 'Marked done' : 'Dismissed';
        const resolvedReason = closingNote ? closingNote : defaultReason;
        updated = await prisma.followUpReminder.update({
          where: { id },
          data: {
            status: action === 'done' ? ReminderStatus.DONE : ReminderStatus.DISMISSED,
            resolvedAt: new Date(),
            resolvedById: req.user!.id,
            resolvedReason,
          },
        });
      }

      await logAudit({
        entityType: 'FollowUpReminder',
        entityId: id,
        action: AuditAction.UPDATE,
        performedById: req.user!.id,
        before: existing as any,
        after: updated as any,
        jobId: existing.jobId,
      });

      emitReminderChanged(existing.jobId);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/reminders/:id/notified ────────────────────────────────────────
// Called by frontend after browser push fires, to record the notification time.
router.patch(
  '/:id/notified',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const updated = await prisma.followUpReminder.update({
        where: { id },
        data: { notifiedAt: new Date() },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
