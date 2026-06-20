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
        where.role = role;
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
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

export default router;
