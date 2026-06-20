import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query } from 'express-validator';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { fuzzySearch } from '../services/searchService';
import { getPaginationParams, paginate } from '../lib/utils';

const router = Router();
router.use(requireAuth);

// ── GET /api/tenants ─────────────────────────────────────────────────────────
// Fuzzy search by name or phone.

router.get(
  '/',
  [
    query('q').optional().isString().trim(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { q } = req.query as { q?: string };
      const { page, limit, skip } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      const allTenants = await prisma.tenant.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        include: {
          lastProperty: { select: { id: true, address: true } },
          lastClient: { select: { id: true, name: true } },
        },
      });

      const filtered = q
        ? fuzzySearch(allTenants, q, ['name', 'phone', 'email'])
        : allTenants;

      const pageData = filtered.slice(skip, skip + limit);
      res.json(paginate(pageData, filtered.length, page, limit));
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/tenants/:id ────────────────────────────────────────────────────

router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenant = await prisma.tenant.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        include: {
          lastProperty: { select: { id: true, address: true } },
          lastClient: { select: { id: true, name: true } },
          _count: { select: { jobs: { where: { deletedAt: null } } } },
        },
      });

      if (!tenant) {
        res.status(404).json({ error: 'Not Found', message: 'Tenant not found.' });
        return;
      }

      res.json(tenant);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/tenants ───────────────────────────────────────────────────────

router.post(
  '/',
  requireRole(Role.PM, Role.ADMIN, Role.OWNER),
  [
    body('name').isString().trim().notEmpty().isLength({ max: 255 })
      .withMessage('name is required.'),
    body('phone').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('email').optional({ nullable: true }).isEmail().normalizeEmail(),
    body('notes').optional({ nullable: true }).isString().trim(),
    body('lastPropertyId').optional({ nullable: true }).isUUID(),
    body('lastClientId').optional({ nullable: true }).isUUID(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        name,
        phone,
        email,
        notes,
        lastPropertyId,
        lastClientId,
      } = req.body as {
        name: string;
        phone?: string | null;
        email?: string | null;
        notes?: string | null;
        lastPropertyId?: string | null;
        lastClientId?: string | null;
      };

      const tenant = await prisma.tenant.create({
        data: {
          name,
          phone,
          email,
          notes,
          lastPropertyId,
          lastClientId,
        },
        include: {
          lastProperty: { select: { id: true, address: true } },
          lastClient: { select: { id: true, name: true } },
        },
      });

      res.status(201).json(tenant);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/tenants/:id/related ─────────────────────────────────────────────
// Returns all historical properties and clients.

router.get(
  '/:id/related',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params['id'];
      
      const tenant = await prisma.tenant.findFirst({
        where: { id: tenantId, deletedAt: null },
        include: {
          lastProperty: { select: { id: true, address: true } },
          lastClient: { select: { id: true, name: true, phone: true, email: true } },
        }
      });

      if (!tenant) {
        res.status(404).json({ error: 'Not Found', message: 'Tenant not found.' });
        return;
      }

      const jobsWithEntities = await prisma.job.findMany({
        where: { tenantId, deletedAt: null },
        select: { 
          property: { select: { id: true, address: true } },
          client: { select: { id: true, name: true, phone: true, email: true } }
        }
      });

      const propertyMap = new Map<string, any>();
      const clientMap = new Map<string, any>();

      if (tenant.lastProperty) propertyMap.set(tenant.lastProperty.id, tenant.lastProperty);
      if (tenant.lastClient) clientMap.set(tenant.lastClient.id, tenant.lastClient);

      jobsWithEntities.forEach(j => {
        propertyMap.set(j.property.id, j.property);
        clientMap.set(j.client.id, j.client);
      });

      res.json({
        properties: Array.from(propertyMap.values()),
        clients: Array.from(clientMap.values()),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── PATCH /api/tenants/:id ─────────────────────────────────────────────────

router.patch(
  '/:id',
  requireRole(Role.PM, Role.ADMIN, Role.OWNER),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty().isLength({ max: 255 }),
    body('phone').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
    body('email').optional({ nullable: true }).isEmail().normalizeEmail(),
    body('notes').optional({ nullable: true }).isString().trim(),
    body('lastPropertyId').optional({ nullable: true }).isUUID(),
    body('lastClientId').optional({ nullable: true }).isUUID(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.tenant.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Tenant not found.' });
        return;
      }

      const {
        name,
        phone,
        email,
        notes,
        lastPropertyId,
        lastClientId,
      } = req.body as {
        name?: string;
        phone?: string | null;
        email?: string | null;
        notes?: string | null;
        lastPropertyId?: string | null;
        lastClientId?: string | null;
      };

      const updated = await prisma.tenant.update({
        where: { id: req.params['id'] },
        data: {
          name,
          phone,
          email,
          notes,
          lastPropertyId,
          lastClientId,
        },
        include: {
          lastProperty: { select: { id: true, address: true } },
          lastClient: { select: { id: true, name: true } },
        },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/tenants/:id (soft delete) ────────────────────────────────────

router.delete(
  '/:id',
  requireRole(Role.ADMIN, Role.OWNER),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const existing = await prisma.tenant.findFirst({
        where: { id: req.params['id'], deletedAt: null },
      });

      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Tenant not found.' });
        return;
      }

      await prisma.tenant.update({
        where: { id: req.params['id'] },
        data: { deletedAt: new Date() },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
