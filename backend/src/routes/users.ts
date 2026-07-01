import { Router, Request, Response, NextFunction } from 'express';
import { body, param } from 'express-validator';
import { Prisma, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { hashPassword } from '../services/authService';
import {
  PERMISSION_GROUPS,
  getEffectivePermissions,
  sanitizeOverrides,
} from '../lib/permissions';

const router = Router();

// Require auth for all user routes.
router.use(requireAuth);

const SELECT_MEMBER = {
  id: true,
  email: true,
  name: true,
  role: true,
  hourlyRate: true,
  canAuthorizeJobs: true,
  permissionOverrides: true,
} as const;

/**
 * GET /api/users/meta/permissions
 * Returns the permission catalog (grouped) for the Team Access matrix UI.
 */
router.get(
  '/meta/permissions',
  requirePermission('users:view'),
  (_req: Request, res: Response): void => {
    res.json({ groups: PERMISSION_GROUPS });
  }
);

/**
 * GET /api/users
 * Lists active team members. Optional query param: ?role=PM
 */
router.get(
  '/',
  requirePermission('users:view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { role } = req.query;

      const where: Prisma.UserWhereInput = { deletedAt: null };
      if (role) {
        if (Object.values(Role).includes(role as Role)) {
          where.role = role as Role;
        } else {
          res.json([]);
          return;
        }
      }

      const users = await prisma.user.findMany({
        where,
        select: SELECT_MEMBER,
        orderBy: { name: 'asc' },
        take: 200,
      });

      res.json(users);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/users/:id
 * Returns a member plus the data the permission-matrix editor needs:
 *  - rolePermissions: the role preset (role defaults, no overrides)
 *  - effectivePermissions: preset + this member's overrides
 *  - overrides: the sparse per-member override map
 */
router.get(
  '/:id',
  requirePermission('users:view'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const member = await prisma.user.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        select: SELECT_MEMBER,
      });

      if (!member) {
        res.status(404).json({ error: 'Not Found', message: 'Member not found.' });
        return;
      }

      const overrides = sanitizeOverrides(member.permissionOverrides);

      res.json({
        member: {
          id: member.id,
          email: member.email,
          name: member.name,
          role: member.role,
          hourlyRate: member.hourlyRate,
          canAuthorizeJobs: member.canAuthorizeJobs,
        },
        overrides,
        rolePermissions: getEffectivePermissions(member.role, null),
        effectivePermissions: getEffectivePermissions(
          member.role,
          overrides,
          member.canAuthorizeJobs
        ),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/users
 * Creates a new team member, optionally with a login password and overrides.
 */
router.post(
  '/',
  requirePermission('users:create'),
  [
    body('name').isString().trim().notEmpty().withMessage('Name is required.'),
    body('email').optional({ nullable: true }).isEmail().normalizeEmail()
      .withMessage('email must be a valid email address.'),
    body('role').isIn(Object.values(Role)).withMessage('A valid role is required.'),
    body('password').optional({ nullable: true }).isString().isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters.'),
    body('permissionOverrides').optional({ nullable: true }).isObject(),
    body('canAuthorizeJobs').optional().isBoolean(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { name, email, role, password, permissionOverrides, canAuthorizeJobs } = req.body;

      const data: Prisma.UserCreateInput = {
        name,
        email: email || `${name.toLowerCase().replace(/\s+/g, '')}@noemail.local`,
        role,
        hourlyRate: 0,
        canAuthorizeJobs: canAuthorizeJobs ?? false,
      };

      if (password) data.passwordHash = await hashPassword(password);
      if (permissionOverrides) data.permissionOverrides = sanitizeOverrides(permissionOverrides);

      const user = await prisma.user.create({
        data,
        select: SELECT_MEMBER,
      });

      res.status(201).json(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(409).json({ error: 'Conflict', message: 'A user with that email already exists.' });
        return;
      }
      next(err);
    }
  }
);

/**
 * PATCH /api/users/:id
 * Updates member profile, role, approver flag, and/or permission overrides.
 */
router.patch(
  '/:id',
  requirePermission('users:edit'),
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty(),
    body('email').optional().isEmail().normalizeEmail(),
    body('role').optional().isIn(Object.values(Role)),
    body('canAuthorizeJobs').optional().isBoolean(),
    body('permissionOverrides').optional({ nullable: true }).isObject(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { name, email, role, canAuthorizeJobs, permissionOverrides } = req.body;

      const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Member not found.' });
        return;
      }

      const data: Prisma.UserUpdateInput = {};
      if (name !== undefined) data.name = name;
      if (email !== undefined) data.email = email;
      if (role !== undefined) data.role = role;
      if (canAuthorizeJobs !== undefined) data.canAuthorizeJobs = canAuthorizeJobs;
      if (permissionOverrides !== undefined) {
        data.permissionOverrides =
          permissionOverrides === null ? Prisma.JsonNull : sanitizeOverrides(permissionOverrides);
      }

      const user = await prisma.user.update({
        where: { id },
        data,
        select: SELECT_MEMBER,
      });

      res.json(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        res.status(409).json({ error: 'Conflict', message: 'A user with that email already exists.' });
        return;
      }
      next(err);
    }
  }
);

/**
 * POST /api/users/:id/reset-password
 * Admin-driven password reset — sets a new password directly.
 */
router.post(
  '/:id/reset-password',
  requirePermission('users:edit'),
  [
    param('id').isUUID(),
    body('password').isString().isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters.'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Member not found.' });
        return;
      }

      await prisma.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(password) },
      });

      res.json({ message: 'Password updated.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/users/:id
 * Soft-deletes (deactivates) a member. Cannot delete yourself or the last OWNER.
 */
router.delete(
  '/:id',
  requirePermission('users:delete'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;

      if (req.user?.id === id) {
        res.status(400).json({ error: 'Bad Request', message: 'You cannot deactivate your own account.' });
        return;
      }

      const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        res.status(404).json({ error: 'Not Found', message: 'Member not found.' });
        return;
      }

      if (existing.role === Role.OWNER) {
        const ownerCount = await prisma.user.count({ where: { role: Role.OWNER, deletedAt: null } });
        if (ownerCount <= 1) {
          res.status(400).json({ error: 'Bad Request', message: 'Cannot deactivate the last remaining Owner.' });
          return;
        }
      }

      await prisma.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
