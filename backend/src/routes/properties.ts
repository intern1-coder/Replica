import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { AuditAction, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { fuzzySearch } from '../services/searchService';
import { logAudit } from '../services/auditService';
import { normalizeAddress, getPaginationParams, paginate } from '../lib/utils';

const router = Router();
router.use(requireAuth);

// ── GET /api/properties ────────────────────────────────────────────────────────
// Fuzzy search by address. Optionally filter by clientId.

router.get(
  '/',
  [
    query('q').optional().isString().trim(),
    query('clientId').optional().isUUID(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q, clientId } = req.query as { q?: string; clientId?: string };
      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      const allProperties = await prisma.property.findMany({
        where: {
          deletedAt: null,
          ...(clientId ? { currentClientId: clientId } : {}),
        },
        orderBy: { address: 'asc' },
        select: {
          id: true,
          address: true,
          normalizedAddress: true,
          buildingGroupId: true,
          currentClientId: true,
          currentClient: { select: { id: true, name: true } },
          keyLocation: true,
          _count: { select: { jobs: { where: { deletedAt: null } } } },
        },
      });

      const filtered = q
        ? fuzzySearch(allProperties, q, ['address', 'normalizedAddress'])
        : allProperties;

      const pageData = filtered.slice(skip, skip + limit);
      res.json(paginate(pageData, filtered.length, page, limit));
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/properties/:id ────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const property = await prisma.property.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          currentClient: { select: { id: true, name: true, email: true, phone: true } },
          tenantHistory: { orderBy: { movedIn: 'desc' } },
          _count: { select: { jobs: { where: { deletedAt: null } } } },
        },
      });

      if (!property) {
        res.status(404).json({ error: 'Not Found', message: 'Property not found.' });
        return;
      }

      res.json(property);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/properties ───────────────────────────────────────────────────────

router.post(
  '/',
  requireRole(Role.PM, Role.ADMIN, Role.OWNER),
  [
    body('address').isString().trim().notEmpty().isLength({ max: 500 })
      .withMessage('address is required.'),
    body('buildingGroupId').optional({ nullable: true }).isString().trim(),
    body('currentClientId').optional({ nullable: true }).isUUID(),
    body('accessNotes').optional({ nullable: true }).isString().trim(),
    body('keyLocation').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        address,
        buildingGroupId,
        currentClientId,
        accessNotes,
        keyLocation,
      } = req.body as {
        address: string;
        buildingGroupId?: string | null;
        currentClientId?: string | null;
        currentTenantName?: string | null;
        currentTenantPhone?: string | null;
        accessNotes?: string | null;
        keyLocation?: string | null;
      };

      const property = await prisma.property.create({
        data: {
          address,
          normalizedAddress: normalizeAddress(address), // pre-computed for search
          buildingGroupId,
          currentClientId,
          accessNotes,
          keyLocation,
        },
        include: {
          currentClient: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        entityType: 'Property',
        entityId: property.id,
        action: AuditAction.CREATE,
        performedById: req.user!.id,
        after: property as any,
      });

      res.status(201).json(property);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/properties/:id ─────────────────────────────────────────────────

router.patch(
  '/:id',
  requireRole(Role.PM, Role.ADMIN, Role.OWNER),
  [
    param('id').isUUID(),
    body('address').optional().isString().trim().notEmpty().isLength({ max: 500 }),
    body('buildingGroupId').optional({ nullable: true }).isString().trim(),
    body('currentClientId').optional({ nullable: true }).isUUID(),
    body('accessNotes').optional({ nullable: true }).isString().trim(),
    body('keyLocation').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.property.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Property not found.' });
        return;
      }

      const {
        address,
        buildingGroupId,
        currentClientId,
        accessNotes,
        keyLocation,
      } = req.body as {
        address?: string;
        buildingGroupId?: string | null;
        currentClientId?: string | null;
        accessNotes?: string | null;
        keyLocation?: string | null;
      };

      const updated = await prisma.property.update({
        where: { id: req.params['id'] },
        data: {
          address,
          // Re-normalise if address changed
          ...(address !== undefined ? { normalizedAddress: normalizeAddress(address) } : {}),
          buildingGroupId,
          currentClientId,
          accessNotes,
          keyLocation,
        },
        include: {
          currentClient: { select: { id: true, name: true } },
        },
      });

      await logAudit({
        entityType: 'Property',
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

// ── DELETE /api/properties/:id (soft delete) ────────────────────────────────────

router.delete(
  '/:id',
  requireRole(Role.ADMIN, Role.OWNER),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.property.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Property not found.' });
        return;
      }

      await prisma.property.update({
        where: { id: req.params['id'] },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        entityType: 'Property',
        entityId: existing.id,
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

// ── GET /api/properties/:id/tenant-history ─────────────────────────────────────

router.get(
  '/:id/tenant-history',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const property = await prisma.property.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        select: { id: true },
      });

      if (!property) {
        res.status(404).json({ error: 'Not Found', message: 'Property not found.' });
        return;
      }

      const history = await prisma.propertyTenantHistory.findMany({
        where: { propertyId: req.params['id'] },
        orderBy: { movedIn: 'desc' },
      });

      res.json(history);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/properties/:id/tenant-history ────────────────────────────────────
// Adds a new tenant-history record (append-only — no updates/deletes on history).
// Optionally closes out the previous open record by setting movedOut.

router.post(
  '/:id/tenant-history',
  requireRole(Role.PM, Role.ADMIN, Role.OWNER),
  [
    param('id').isUUID(),
    body('tenantName').isString().trim().notEmpty().isLength({ max: 255 }),
    body('tenantPhone').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('movedIn').isISO8601().toDate().withMessage('movedIn must be a valid ISO date.'),
    body('notes').optional({ nullable: true }).isString().trim(),
    body('closeCurrentTenant').optional().isBoolean().toBoolean()
      .withMessage('closeCurrentTenant must be a boolean.'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const propertyId = req.params['id'];

      const property = await prisma.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { id: true },
      });

      if (!property) {
        res.status(404).json({ error: 'Not Found', message: 'Property not found.' });
        return;
      }

      const { tenantName, tenantPhone, movedIn, notes, closeCurrentTenant } = req.body as {
        tenantName: string;
        tenantPhone?: string | null;
        movedIn: Date;
        notes?: string | null;
        closeCurrentTenant?: boolean;
      };

      // Optionally close the most recent open record
      const newEntry = await prisma.$transaction(async (tx) => {
        if (closeCurrentTenant) {
          await tx.propertyTenantHistory.updateMany({
            where: { propertyId, movedOut: null },
            data: { movedOut: movedIn },
          });
        }

        return tx.propertyTenantHistory.create({
          data: { propertyId, tenantName, tenantPhone, movedIn, notes },
        });
      });

      res.status(201).json(newEntry);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/properties/:id/tenant-history/:historyId ────────────────────────
// Close out a tenant record (set movedOut). Only movedOut is patchable —
// historical data is otherwise immutable.

router.patch(
  '/:id/tenant-history/:historyId',
  requireRole(Role.PM, Role.ADMIN, Role.OWNER),
  [
    param('id').isUUID(),
    param('historyId').isUUID(),
    body('movedOut').isISO8601().toDate().withMessage('movedOut must be a valid ISO date.'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const record = await prisma.propertyTenantHistory.findFirst({
        where: { id: req.params['historyId'], propertyId: req.params['id'] },
      });

      if (!record) {
        res.status(404).json({ error: 'Not Found', message: 'Tenant history record not found.' });
        return;
      }

      const { movedOut } = req.body as { movedOut: Date };

      const updated = await prisma.propertyTenantHistory.update({
        where: { id: req.params['historyId'] },
        data: { movedOut },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
