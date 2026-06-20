import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import prisma from '../lib/prisma';
import { comparePassword, generateJWT } from '../services/authService';
import { validate } from '../middleware/errorHandler';
import { authLimiter } from '../middleware/rateLimiter';
import { requireAuth } from '../middleware/auth';
import logger from '../lib/logger';

const router = Router();

// ── POST /api/auth/login ────────────────────────────────────────────────────────
// Authenticates a user with email and password, returning a JWT.

router.post(
  '/login',
  authLimiter,
  [
    body('email')
      .isEmail().withMessage('A valid email address is required.')
      .normalizeEmail(),
    body('password')
      .isString().withMessage('Password is required.')
      .notEmpty(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, email: true, name: true, role: true, passwordHash: true },
      });

      if (!user || !user.passwordHash) {
        logger.warn('Failed login attempt (user not found or no password)', { email });
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password.' });
        return;
      }

      const isMatch = await comparePassword(password, user.passwordHash);
      if (!isMatch) {
        logger.warn('Failed login attempt (incorrect password)', { email });
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password.' });
        return;
      }

      const jwtToken = generateJWT(user);

      logger.info('User authenticated successfully', { userId: user.id, role: user.role });

      res.status(200).json({
        token: jwtToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/auth/me ───────────────────────────────────────────────────────────
// Returns the currently authenticated user.

router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.status(200).json({ user: req.user });
});

export default router;
