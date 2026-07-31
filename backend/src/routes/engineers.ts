import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { Role, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/errorHandler';
import { logAudit } from '../services/auditService';

const router = Router();

router.use(requireAuth);

// All write operations require PM or above; DELETE is restricted to ADMIN/OWNER
// because removing an engineer could orphan historical work logs (soft-delete
// only sets deletedAt, so data is preserved but the engineer is hidden from lists).

// ── GET /api/engineers ─────────────────────────────────────────────────────────
// hourlyRate is omitted (not sent as null) for callers lacking
// engineer_costs:view — the frontend distinguishes "engineer has no rate"
// (null) from "you may not see rates" (key absent) and still resolves a
// correctly-priced work log server-side even when the picker can't show it.
// ?includeInactive=true also returns soft-deleted engineers, but only for
// members holding engineers:delete (Admin/Owner by default) — mirrors
// clients.ts's includeInactive gating.

router.get(
  '/',
  requirePermission('engineers:view'),
  [
    query('search').optional().isString().trim(),
    query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
    query('includeInactive').optional().isBoolean().toBoolean(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { search, limit } = req.query as { search?: string; limit?: number };
      const includeInactive =
        (req.query['includeInactive'] as unknown as boolean) === true &&
        req.user!.can('engineers:delete');

      const where: any = includeInactive ? {} : { deletedAt: null };
      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }

      const canSeeRates = req.user!.can('engineer_costs:view');

      const engineers = await prisma.engineer.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          ...(canSeeRates ? { hourlyRate: true } : {}),
        },
        orderBy: { name: 'asc' },
        take: limit ?? 200,
      });
      res.json(engineers);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/engineers ────────────────────────────────────────────────────────

router.post(
  '/',
  requirePermission('engineers:create'),
  [
    body('name').isString().trim().notEmpty().withMessage('Name is required.'),
    body('phone').optional({ nullable: true }).isString().trim(),
    body('email').optional({ nullable: true }).isString().trim(),
    body('hourlyRate')
      .optional({ nullable: true })
      .isDecimal().bail()
      .isFloat({ min: 0, max: 10000 })
      .withMessage('hourlyRate must be a decimal between 0 and 10000.'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, phone, email, hourlyRate } = req.body;

      const engineer = await prisma.engineer.create({
        data: {
          name,
          phone: phone || null,
          email: email || null,
          hourlyRate: hourlyRate ? hourlyRate : null,
        },
        select: { id: true, name: true, phone: true, email: true, hourlyRate: true },
      });

      await logAudit({
        entityType: 'Engineer',
        entityId: engineer.id,
        action: AuditAction.CREATE,
        performedById: req.user!.id,
        after: engineer as any,
      });

      res.status(201).json(engineer);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/engineers/:id ───────────────────────────────────────────────────

router.patch(
  '/:id',
  requirePermission('engineers:edit'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('phone').optional({ nullable: true }).isString().trim(),
    body('email').optional({ nullable: true }).isString().trim(),
    body('hourlyRate')
      .optional({ nullable: true })
      .isDecimal().bail()
      .isFloat({ min: 0, max: 10000 })
      .withMessage('hourlyRate must be a decimal between 0 and 10000.'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.engineer.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Engineer not found.' });
        return;
      }

      const { name, phone, email, hourlyRate } = req.body;

      const updated = await prisma.engineer.update({
        where: { id: req.params['id'] },
        data: {
          name: name ?? undefined,
          phone: phone !== undefined ? phone : undefined,
          email: email !== undefined ? email : undefined,
          hourlyRate: hourlyRate !== undefined ? hourlyRate : undefined,
        },
        select: { id: true, name: true, phone: true, email: true, hourlyRate: true },
      });

      await logAudit({
        entityType: 'Engineer',
        entityId: updated.id,
        action: AuditAction.UPDATE,
        performedById: req.user!.id,
        before: existing as any,
        after: updated as any,
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/engineers/:id ──────────────────────────────────────────────────

router.delete(
  '/:id',
  requirePermission('engineers:delete'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.engineer.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Engineer not found.' });
        return;
      }

      await prisma.engineer.update({
        where: { id: req.params['id'] },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        entityType: 'Engineer',
        entityId: req.params['id'],
        action: AuditAction.DELETE,
        performedById: req.user!.id,
        before: existing as any,
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
