import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import prisma from '../lib/prisma';
import {
  comparePassword,
  generateJWT,
  hashPassword,
  generateResetToken,
  hashResetToken,
} from '../services/authService';
import { sendPasswordResetEmail } from '../services/emailService';
import { validate } from '../middleware/errorHandler';
import { authLimiter } from '../middleware/rateLimiter';
import { requireAuth } from '../middleware/auth';
import config from '../config';
import logger, { maskEmail } from '../lib/logger';

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
        select: { id: true, email: true, name: true, role: true, passwordHash: true, canAuthorizeJobs: true, tokenVersion: true },
      });

      if (!user || !user.passwordHash) {
        logger.warn('Failed login attempt (user not found or no password)', { maskedEmail: maskEmail(email), ip: req.ip });
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password.' });
        return;
      }

      const isMatch = await comparePassword(password, user.passwordHash);
      if (!isMatch) {
        logger.warn('Failed login attempt (incorrect password)', { maskedEmail: maskEmail(email), ip: req.ip });
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
  const { id, email, name, role, canAuthorizeJobs, permissions } = req.user!;
  res.status(200).json({
    user: { id, email, name, role, canAuthorizeJobs },
    permissions,
  });
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────────
// Always responds 200 with a generic message (no user enumeration). If the email
// belongs to a real, active member, a single-use reset token is emailed.

router.post(
  '/forgot-password',
  authLimiter,
  [body('email').isEmail().normalizeEmail()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const generic = {
      message: 'If an account exists for that email, a password reset link has been sent.',
    };
    try {
      const { email } = req.body;
      const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });

      if (user) {
        const rawToken = generateResetToken();
        const expiresAt = new Date(Date.now() + config.passwordReset.expiresMinutes * 60_000);

        await prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashResetToken(rawToken), expiresAt },
        });

        const resetUrl = `${config.frontendUrl}/reset-password?token=${rawToken}`;
        try {
          await sendPasswordResetEmail(user.email, user.name, resetUrl);
        } catch (mailErr) {
          // Don't leak failures to the client; log for ops. (Many members use
          // @noemail.local addresses where delivery is expected to fail.)
          logger.warn('Failed to send password reset email', {
            userId: user.id,
            error: mailErr instanceof Error ? mailErr.message : String(mailErr),
          });
        }
      }

      res.status(200).json(generic);
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/auth/reset-password ────────────────────────────────────────────────
// Consumes a single-use token and sets a new password.

router.post(
  '/reset-password',
  authLimiter,
  [
    body('token').isString().notEmpty(),
    body('password').isString().isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters.'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, password } = req.body;
      const tokenHash = hashResetToken(token);

      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

      if (!record || record.usedAt || record.expiresAt < new Date()) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'This password reset link is invalid or has expired.',
        });
        return;
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: record.userId },
          data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } },
        }),
        prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
      ]);

      logger.info('Password reset completed', { userId: record.userId });
      res.status(200).json({ message: 'Your password has been reset. You can now log in.' });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/auth/change-password ───────────────────────────────────────────────
// Logged-in member changes their own password (must supply the current one).

router.post(
  '/change-password',
  requireAuth,
  [
    body('currentPassword').isString().notEmpty(),
    body('newPassword').isString().isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters.'),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { id: true, passwordHash: true },
      });

      if (!user || !user.passwordHash || !(await comparePassword(currentPassword, user.passwordHash))) {
        res.status(401).json({ error: 'Unauthorized', message: 'Current password is incorrect.' });
        return;
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
      });

      res.status(200).json({ message: 'Password changed successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
