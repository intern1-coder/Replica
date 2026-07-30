import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import prisma from '../lib/prisma';
import { Role } from '@prisma/client';
import {
  getEffectivePermissions,
  sanitizeOverrides,
  type PermissionKey,
} from '../lib/permissions';

// ── resolveAuthenticatedUser ─────────────────────────────────────────────────────

export interface ResolvedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  canAuthorizeJobs: boolean;
  permissions: Record<PermissionKey, boolean>;
  can: (key: PermissionKey) => boolean;
}

export type ResolveAuthResult =
  | { ok: true; user: ResolvedUser }
  | { ok: false; reason: 'not_found' | 'stale_token' };

/**
 * Verifies a decoded JWT payload against the live User record — the shared
 * core of requireAuth. Also used by Socket.io's handshake auth (lib/socket.ts)
 * so a long-lived socket connection can never be more trusting than an HTTP
 * request made with the same token: both reject a soft-deleted user and both
 * reject a stale tokenVersion (bumped on password reset/change — the
 * force-logout mechanism).
 */
export async function resolveAuthenticatedUser(payload: jwt.JwtPayload): Promise<ResolveAuthResult> {
  const user = await prisma.user.findFirst({
    where: { id: payload['userId'] as string, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      canAuthorizeJobs: true,
      permissionOverrides: true,
      tokenVersion: true,
    },
  });

  if (!user) {
    return { ok: false, reason: 'not_found' };
  }

  if ((payload['tokenVersion'] as number) !== user.tokenVersion) {
    return { ok: false, reason: 'stale_token' };
  }

  const permissions = getEffectivePermissions(
    user.role,
    sanitizeOverrides(user.permissionOverrides),
    user.canAuthorizeJobs
  );

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      canAuthorizeJobs: user.canAuthorizeJobs,
      permissions,
      can: (key: PermissionKey) => !!permissions[key],
    },
  };
}

// ── requireAuth ────────────────────────────────────────────────────────────────

/**
 * Verifies the JWT in the Authorization header.
 * Attaches the live user record to req.user.
 *
 * Returns 401 if:
 *   - The header is missing or not in `Bearer <token>` format
 *   - The token is invalid or expired (forwarded to errorHandler)
 *   - The user has been soft-deleted since the token was issued
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header.',
    });
    return;
  }

  const token = authHeader.slice(7);

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
  } catch (err) {
    // JsonWebTokenError / TokenExpiredError — handled by errorHandler
    next(err);
    return;
  }

  const resolved = await resolveAuthenticatedUser(payload);

  if (!resolved.ok) {
    res.status(401).json({
      error: 'Unauthorized',
      message: resolved.reason === 'stale_token'
        ? 'Session expired. Please log in again.'
        : 'User account not found or has been deactivated.',
    });
    return;
  }

  req.user = resolved.user;
  next();
}

// ── requireRole ───────────────────────────────────────────────────────────────

/**
 * Role-based access guard. Use after requireAuth.
 *
 * @example
 *   router.delete('/jobs/:id', requireAuth, requireRole('PM', 'ADMIN'), handler);
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `This action requires one of the following roles: ${roles.join(', ')}.`,
      });
      return;
    }
    next();
  };
}

// ── requirePermission ────────────────────────────────────────────────────────

/**
 * Granular permission guard. Use after requireAuth. The member's effective
 * permissions are resolved from their role preset + per-member overrides.
 *
 * @example
 *   router.patch('/jobs/:id', requireAuth, requirePermission('jobs:edit'), handler);
 */
export function requirePermission(key: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
      return;
    }
    if (!req.user.can(key)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to perform this action.',
      });
      return;
    }
    next();
  };
}
