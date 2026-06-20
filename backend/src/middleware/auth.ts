import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import prisma from '../lib/prisma';
import { Role } from '@prisma/client';

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

  // Re-check the user is still active — a token issued before a soft-delete
  // must not be accepted after deactivation.
  const user = await prisma.user.findFirst({
    where: { id: payload['userId'] as string, deletedAt: null },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'User account not found or has been deactivated.',
    });
    return;
  }

  req.user = user;
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
