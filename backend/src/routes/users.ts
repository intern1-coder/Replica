import { Router, Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Require auth for all user routes
router.use(requireAuth);

/**
 * GET /api/users
 * Optional query param: ?role=CONTRACTOR
 */
router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { role } = req.query;
      
      const where: any = { deletedAt: null };
      if (role) {
        if (Object.values(Role).includes(role as Role)) {
          where.role = role;
        } else {
          // If requested role is not a valid enum, return empty array to prevent Prisma 422 error
          res.json([]);
          return;
        }
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          hourlyRate: true,
          canAuthorizeJobs: true,
        },
        orderBy: { name: 'asc' },
      });

      res.json(users);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/users/:id
 * Admin/Owner only. Updates user fields like canAuthorizeJobs.
 */
router.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.user?.role !== 'ADMIN' && req.user?.role !== 'OWNER') {
        res.status(403).json({ error: 'Forbidden', message: 'Only Admins and Owners can manage users.' });
        return;
      }

      const { id } = req.params;
      const { canAuthorizeJobs } = req.body;

      const user = await prisma.user.update({
        where: { id },
        data: { canAuthorizeJobs },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          canAuthorizeJobs: true,
        },
      });

      res.json(user);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/users
 * Create a new user (usually for contractors without login).
 */
router.post(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.user?.role !== 'ADMIN' && req.user?.role !== 'OWNER' && req.user?.role !== 'PM') {
        res.status(403).json({ error: 'Forbidden', message: 'Not authorized to create users.' });
        return;
      }

      const { name, email, role } = req.body;

      if (!name || !role) {
        res.status(400).json({ error: 'Bad Request', message: 'Name and role are required.' });
        return;
      }

      const user = await prisma.user.create({
        data: {
          name,
          email: email || `${name.toLowerCase().replace(/\s+/g, '')}@noemail.local`,
          role,
          hourlyRate: 0,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      });

      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
