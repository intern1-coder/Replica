import { Router, Request, Response, NextFunction } from 'express';
import { param, query } from 'express-validator';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { getPaginationParams, paginate } from '../lib/utils';

const router = Router();
router.use(requireAuth);
// Only Admin and Owner can view audit logs.
router.use(requireRole(Role.ADMIN, Role.OWNER));

// ── GET /api/audit-logs ────────────────────────────────────────────────────────
// Retrieve audit logs globally or filtered by entity/job.
// Append-only system: NO UPDATE OR DELETE ROUTES EXIST. (Rules.md)

router.get(
  '/',
  [
    query('jobId').optional().isUUID(),
    query('entityType').optional().isString(),
    query('entityId').optional().isUUID(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId, entityType, entityId } = req.query as {
        jobId?: string;
        entityType?: string;
        entityId?: string;
      };
      
      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      const where: any = {};
      if (jobId) where.jobId = jobId;
      if (entityType) where.entityType = entityType;
      if (entityId) where.entityId = entityId;

      const [logs, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          where,
          include: {
            performedBy: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      res.json(paginate(logs, total, page, limit));
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/audit-logs/:id ────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const log = await prisma.auditLog.findUnique({
        where: { id: req.params['id'] },
        include: {
          performedBy: { select: { id: true, name: true, role: true } },
        },
      });

      if (!log) {
        res.status(404).json({ error: 'Not Found', message: 'Audit log not found.' });
        return;
      }

      res.json(log);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
