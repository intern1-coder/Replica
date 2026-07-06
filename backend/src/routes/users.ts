import { Router, Request, Response, NextFunction } from 'express';
import { body, param } from 'express-validator';
import { Prisma, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { hashPassword } from '../services/authService';
import { sendPasswordSetupEmail } from '../services/passwordSetupService';
import logger, { maskEmail } from '../lib/logger';
import {
  PERMISSION_GROUPS,
  getEffectivePermissions,
  sanitizeOverrides,
} from '../lib/permissions';
import { emitToAll, emitUserPermissionsChanged } from '../lib/socket';
import {
  canAssignRole,
  canManageMember,
  shouldHideFromTeamList,
} from '../lib/roleHierarchy';

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
  passwordHash: true,
} as const;

// Never expose the hash — replace it with a hasPassword flag so the UI can
// tell which members still need to accept their invite.
function toMemberResponse<T extends { passwordHash: string | null }>(user: T) {
  const { passwordHash, ...rest } = user;
  return { ...rest, hasPassword: passwordHash !== null };
}

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

      const actorRole = req.user!.role;

      const where: Prisma.UserWhereInput = { deletedAt: null };
      if (role) {
        if (!Object.values(Role).includes(role as Role)) {
          res.json([]);
          return;
        }
        if (actorRole !== Role.SUPER_ADMIN && role === Role.SUPER_ADMIN) {
          res.json([]);
          return;
        }
        where.role = role as Role;
      } else if (actorRole !== Role.SUPER_ADMIN) {
        where.role = { not: Role.SUPER_ADMIN };
      }

      const users = await prisma.user.findMany({
        where,
        select: SELECT_MEMBER,
        orderBy: { name: 'asc' },
        take: 200,
      });

      res.json(users.map(toMemberResponse));
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

      if (shouldHideFromTeamList(member.role, req.user!.role)) {
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
          hasPassword: member.passwordHash !== null,
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
  requirePermission('users:view'),
  requirePermission('users:create'),
  [
    body('name').isString().trim().notEmpty().withMessage('Name is required.'),
    body('email').isEmail().normalizeEmail()
      .withMessage('A valid email address is required.'),
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
      const actorRole = req.user!.role;

      if (!canAssignRole(actorRole, role as Role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to assign that role.',
        });
        return;
      }

      const data: Prisma.UserCreateInput = {
        name,
        email,
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

      emitToAll('users:changed', { ts: Date.now() });

      // No password set → email the member a link to choose their own.
      // A failed send must not roll back the created user; the UI offers
      // "Resend invite" instead.
      let warning: string | undefined;
      if (!password) {
        try {
          await sendPasswordSetupEmail(user, { isInvite: true });
        } catch (mailErr) {
          logger.warn('Failed to send invite email', {
            userId: user.id,
            maskedEmail: maskEmail(user.email),
            error: mailErr instanceof Error ? mailErr.message : String(mailErr),
          });
          warning = 'Member created, but the invite email could not be sent. Use "Resend invite" once email is working.';
        }
      }

      res.status(201).json({ ...toMemberResponse(user), ...(warning ? { warning } : {}) });
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
  requirePermission('users:view'),
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

      const actorRole = req.user!.role;

      if (!canManageMember(actorRole, existing.role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to edit this member.',
        });
        return;
      }

      if (role !== undefined && !canAssignRole(actorRole, role as Role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to assign that role.',
        });
        return;
      }

      if (
        existing.role === Role.SUPER_ADMIN &&
        role !== undefined &&
        role !== Role.SUPER_ADMIN
      ) {
        const superAdminCount = await prisma.user.count({
          where: { role: Role.SUPER_ADMIN, deletedAt: null },
        });
        if (superAdminCount <= 1) {
          res.status(400).json({
            error: 'Bad Request',
            message: 'Cannot demote the last remaining Super Admin.',
          });
          return;
        }
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

      const permissionsChanged =
        role !== undefined ||
        permissionOverrides !== undefined ||
        canAuthorizeJobs !== undefined;

      if (permissionsChanged) {
        emitUserPermissionsChanged(id, req.user?.id);
      }

      emitToAll('users:changed', { ts: Date.now() });

      res.json(toMemberResponse(user));
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
 * POST /api/users/:id/resend-invite
 * Re-sends the set-password invite email to a member who has not yet set a
 * password (lost or expired invite link).
 */
router.post(
  '/:id/resend-invite',
  requirePermission('users:view'),
  requirePermission('users:create'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const member = await prisma.user.findFirst({
        where: { id: req.params['id'], deletedAt: null },
        select: { id: true, email: true, name: true, passwordHash: true, role: true },
      });

      if (!member || shouldHideFromTeamList(member.role, req.user!.role)) {
        res.status(404).json({ error: 'Not Found', message: 'Member not found.' });
        return;
      }

      if (member.passwordHash !== null) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'This member has already set a password. Use the password reset flow instead.',
        });
        return;
      }

      try {
        await sendPasswordSetupEmail(member, { isInvite: true });
      } catch (mailErr) {
        logger.warn('Failed to resend invite email', {
          userId: member.id,
          maskedEmail: maskEmail(member.email),
          error: mailErr instanceof Error ? mailErr.message : String(mailErr),
        });
        res.status(502).json({
          error: 'Bad Gateway',
          message: 'The invite email could not be sent. Check the SMTP configuration and try again.',
        });
        return;
      }

      res.json({ message: `Invite sent to ${member.email}.` });
    } catch (err) {
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
  requirePermission('users:view'),
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

      if (!canManageMember(req.user!.role, existing.role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to reset this member\'s password.',
        });
        return;
      }

      await prisma.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
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
  requirePermission('users:view'),
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

      if (!canManageMember(req.user!.role, existing.role)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to deactivate this member.',
        });
        return;
      }

      if (existing.role === Role.SUPER_ADMIN) {
        const superAdminCount = await prisma.user.count({
          where: { role: Role.SUPER_ADMIN, deletedAt: null },
        });
        if (superAdminCount <= 1) {
          res.status(400).json({
            error: 'Bad Request',
            message: 'Cannot deactivate the last remaining Super Admin.',
          });
          return;
        }
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

      emitUserPermissionsChanged(id, req.user?.id);
      emitToAll('users:changed', { ts: Date.now() });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
