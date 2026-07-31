import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { AuditAction, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { fuzzySearch } from '../services/searchService';
import { getPaginationParams, paginate } from '../lib/utils';
import { logAudit } from '../services/auditService';

const router = Router();

// All client routes require at minimum a valid session
router.use(requireAuth);

// ── GET /api/clients ───────────────────────────────────────────────────────────
// Lists active clients. Supports optional fuzzy search via ?q=<query>.
// Fuzzy search operates in-memory on the full active-client set — acceptable
// at this scale (5 users, bounded number of clients).
// ?includeInactive=true also returns soft-deleted clients, but only for members
// holding clients:delete (Admin/Owner by default) — others silently get actives.

router.get(
  '/',
  requirePermission('clients:view'),
  [
    query('q').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('includeInactive').optional().isBoolean().toBoolean(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q } = req.query as { q?: string };
      const includeInactive =
        (req.query['includeInactive'] as unknown as boolean) === true &&
        req.user!.can('clients:delete');
      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      // Load all active clients for fuzzy search (small dataset — this is fine)
      const allClients = await prisma.client.findMany({
        where: includeInactive ? {} : { deletedAt: null },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          address: true,
          createdAt: true,
          deletedAt: true,
          _count: { select: { jobs: { where: { deletedAt: null } } } },
        },
      });

      // Apply fuzzy search, then paginate
      const filtered = q ? fuzzySearch(allClients, q, ['name', 'email', 'address']) : allClients;
      const pageData  = filtered.slice(skip, skip + limit);

      res.json(paginate(pageData, filtered.length, page, limit));
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/clients/:id ───────────────────────────────────────────────────────

router.get(
  '/:id',
  requirePermission('clients:view'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const client = await prisma.client.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          properties: {
            where: { deletedAt: null },
            select: { id: true, address: true, tenants: { select: { name: true } } },
            orderBy: { address: 'asc' },
          },
          _count: { select: { jobs: { where: { deletedAt: null } } } },
        },
      });

      if (!client) {
        res.status(404).json({ error: 'Not Found', message: 'Client not found.' });
        return;
      }

      res.json(client);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/clients ──────────────────────────────────────────────────────────

router.post(
  '/',
  requirePermission('clients:create'),
  [
    body('name').isString().trim().notEmpty().isLength({ max: 255 })
      .withMessage('name is required and must be ≤ 255 characters.'),
    body('email').optional({ nullable: true }).isEmail().normalizeEmail()
      .withMessage('email must be a valid email address.'),
    body('phone').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('address').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('notes').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, email, phone, address, notes } = req.body as {
        name: string;
        email?: string | null;
        phone?: string | null;
        address?: string | null;
        notes?: string | null;
      };

      const client = await prisma.client.create({
        data: { name, email, phone, address, notes },
      });

      await logAudit({
        entityType: 'Client',
        entityId: client.id,
        action: AuditAction.CREATE,
        performedById: req.user!.id,
        after: client as any,
      });

      res.status(201).json(client);
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/clients/:id ────────────────────────────────────────────────────

router.patch(
  '/:id',
  requirePermission('clients:edit'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty().isLength({ max: 255 }),
    body('email').optional({ nullable: true }).isEmail().normalizeEmail(),
    body('phone').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('address').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('notes').optional({ nullable: true }).isString().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.client.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Client not found.' });
        return;
      }

      const { name, email, phone, address, notes } = req.body as {
        name?: string;
        email?: string | null;
        phone?: string | null;
        address?: string | null;
        notes?: string | null;
      };

      const updated = await prisma.client.update({
        where: { id: req.params['id'] },
        data: { name, email, phone, address, notes },
      });

      await logAudit({
        entityType: 'Client',
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

// ── GET /api/clients/:id/related ─────────────────────────────────────────────
// Returns all currently managed properties, and historical properties from jobs.

router.get(
  '/:id/related',
  requirePermission('clients:view'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const clientId = req.params['id'];
      
      const client = await prisma.client.findFirst({
        where: { id: clientId, deletedAt: null },
      });

      if (!client) {
        res.status(404).json({ error: 'Not Found', message: 'Client not found.' });
        return;
      }

      const currentProperties = await prisma.property.findMany({
        where: { currentClientId: clientId, deletedAt: null },
        select: { id: true, address: true }
      });

      const jobsWithProperties = await prisma.job.findMany({
        where: { clientId, deletedAt: null },
        select: { property: { select: { id: true, address: true } } },
        distinct: ['propertyId']
      });

      const propertyMap = new Map<string, any>();
      jobsWithProperties.forEach(j => propertyMap.set(j.property.id, j.property));
      currentProperties.forEach(p => propertyMap.set(p.id, p));

      res.json({
        properties: Array.from(propertyMap.values())
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/clients/:id/restore ────────────────────────────────────────────
// Reactivates a soft-deleted client. Same permission as deactivation.

router.patch(
  '/:id/restore',
  requirePermission('clients:delete'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.client.findFirst({
        where: { id: req.params['id'], deletedAt: { not: null } },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Inactive client not found.' });
        return;
      }

      const updated = await prisma.client.update({
        where: { id: req.params['id'] },
        data: { deletedAt: null },
      });

      await logAudit({
        entityType: 'Client',
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

// ── DELETE /api/clients/:id (soft delete) ──────────────────────────────────────

router.delete(
  '/:id',
  requirePermission('clients:delete'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.client.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Client not found.' });
        return;
      }

      await prisma.client.update({
        where: { id: req.params['id'] },
        data: { deletedAt: new Date() },
      });

      await logAudit({
        entityType: 'Client',
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

export default router;
