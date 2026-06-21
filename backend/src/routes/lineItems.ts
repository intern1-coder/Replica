import { Router, Request, Response, NextFunction } from 'express';
import { body, param } from 'express-validator';
import { Role, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { logAudit } from '../services/auditService';

const router = Router({ mergeParams: true }); // Allows accessing :jobId from parent router if mounted that way
router.use(requireAuth);
router.use(requireRole(Role.PM, Role.ADMIN, Role.OWNER));

// Helper: Recalculates and updates the total quoted value for a job
async function updateJobTotal(jobId: string, tx: any = prisma) {
  const items = await tx.jobQuoteLineItem.findMany({
    where: { jobId, deletedAt: null }
  });
  const total = items.reduce((sum: number, item: any) => sum + Number(item.price), 0);
  await tx.job.update({
    where: { id: jobId },
    data: { quotedValue: total }
  });
  return total;
}

// ── GET /api/jobs/:jobId/line-items ──────────────────────────────────────────
router.get(
  '/',
  [param('jobId').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const items = await prisma.jobQuoteLineItem.findMany({
        where: { jobId: req.params['jobId'], deletedAt: null },
        orderBy: { createdAt: 'asc' },
      });
      res.json(items);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/jobs/:jobId/line-items ─────────────────────────────────────────
router.post(
  '/',
  [
    param('jobId').isUUID(),
    body('description').isString().notEmpty().trim(),
    body('price').isDecimal({ decimal_digits: '0,2' }),
    body('status').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId } = req.params;
      const { description, price, status } = req.body;

      const job = await prisma.job.findFirst({ where: { id: jobId, deletedAt: null } });
      if (!job) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      const item = await prisma.$transaction(async (tx) => {
        const newItem = await tx.jobQuoteLineItem.create({
          data: {
            jobId,
            description,
            price,
            status: status || 'COMPLETED',
          },
        });
        await updateJobTotal(jobId, tx);
        return newItem;
      });

      await logAudit({
        entityType: 'JobQuoteLineItem',
        entityId: item.id,
        action: AuditAction.CREATE,
        performedById: req.user!.id,
        after: item as any,
        jobId,
      });

      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/jobs/:jobId/line-items/:id ────────────────────────────────────
router.patch(
  '/:id',
  [
    param('jobId').isUUID(),
    param('id').isUUID(),
    body('description').optional().isString().trim(),
    body('price').optional().isDecimal({ decimal_digits: '0,2' }),
    body('status').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId, id } = req.params;
      const { description, price, status } = req.body;

      const existing = await prisma.jobQuoteLineItem.findFirst({
        where: { id, jobId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Line item not found.' });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const item = await tx.jobQuoteLineItem.update({
          where: { id },
          data: {
            description,
            price,
            status,
          },
        });
        await updateJobTotal(jobId, tx);
        return item;
      });

      await logAudit({
        entityType: 'JobQuoteLineItem',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        performedById: req.user!.id,
        before: existing as any,
        after: updated as any,
        jobId,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/jobs/:jobId/line-items/:id ───────────────────────────────────
router.delete(
  '/:id',
  [param('jobId').isUUID(), param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { jobId, id } = req.params;

      const existing = await prisma.jobQuoteLineItem.findFirst({
        where: { id, jobId, deletedAt: null },
      });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Line item not found.' });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.jobQuoteLineItem.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        await updateJobTotal(jobId, tx);
      });

      await logAudit({
        entityType: 'JobQuoteLineItem',
        entityId: id,
        action: AuditAction.DELETE,
        performedById: req.user!.id,
        before: existing as any,
        jobId,
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
