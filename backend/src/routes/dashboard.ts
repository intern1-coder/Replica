import { Router, Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
// Available to PMs, Admins, Owners
router.use(requireRole(Role.PM, Role.ADMIN, Role.OWNER));

// ── GET /api/dashboard/daily-tasks ─────────────────────────────────────────────
// Computed view merging recent Jobs, Communications, and Audits to show what
// needs attention today or what happened recently.

router.get(
  '/daily-tasks',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // 1. Jobs scheduled for today
      const jobsToday = await prisma.job.findMany({
        where: {
          scheduledDate: {
            gte: startOfDay,
            lt: new Date(startOfDay.getTime() + 86400000), // +1 day
          },
          deletedAt: null,
        },
        include: { property: { select: { address: true } } },
      });

      // 2. Recent communications logged today
      const commsToday = await prisma.communicationLog.findMany({
        where: {
          loggedAt: { gte: startOfDay },
        },
        include: { performedBy: { select: { name: true } }, job: { select: { sequence: true } } },
        orderBy: { loggedAt: 'desc' },
        take: 50,
      });

      // 3. Jobs sitting in 'TO_BE_CHECKED' (needs PM review)
      const toCheck = await prisma.job.findMany({
        where: { status: 'TO_BE_CHECKED', deletedAt: null },
        include: { property: { select: { address: true } } },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        jobsScheduledToday: jobsToday,
        recentCommunications: commsToday,
        actionRequired: {
          toBeChecked: toCheck,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
