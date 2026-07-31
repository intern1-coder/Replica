import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { Role, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/errorHandler';
import { logAudit } from '../services/auditService';

const router = Router();

router.use(requireAuth);

// ── Helper: read VAT rate from DB ──────────────────────────────────────────────

// Default of 0.2 = 20% UK standard VAT. Exported so documents.ts can call it
// without an extra HTTP hop when building PDF snapshots.
export async function getVatRate(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: 'vat_rate' } });
  if (!setting) return 0.2;
  const parsed = parseFloat(setting.value);
  return isNaN(parsed) ? 0.2 : parsed;
}

// ── GET /api/settings/vat-rate ─────────────────────────────────────────────────

router.get(
  '/vat-rate',
  requirePermission('settings:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vatRate = await getVatRate();
      res.json({ vatRate });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/settings/vat-rate ───────────────────────────────────────────────

router.patch(
  '/vat-rate',
  requirePermission('settings:edit'),
  [
    body('vatRate')
      .isFloat({ min: 0, max: 1 })
      .withMessage('vatRate must be a number between 0 and 1 (e.g. 0.2 for 20%).'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vatRate: number = req.body.vatRate;

      const before = await prisma.setting.findUnique({ where: { key: 'vat_rate' } });

      await prisma.setting.upsert({
        where: { key: 'vat_rate' },
        create: { key: 'vat_rate', value: String(vatRate) },
        update: { value: String(vatRate) },
      });

      await logAudit({
        entityType: 'Setting',
        entityId: 'vat_rate',
        action: before ? AuditAction.UPDATE : AuditAction.CREATE,
        performedById: req.user!.id,
        before: before ? { value: before.value } : null,
        after: { value: String(vatRate) },
      });

      res.json({ vatRate });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
