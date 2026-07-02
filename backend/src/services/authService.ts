import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import config from '../config';
import { User } from '@prisma/client';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  canAuthorizeJobs: boolean;
  tokenVersion: number;
}

// ── Password helpers ───────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── Password reset token helpers ────────────────────────────────────────────────

/** Generates a cryptographically-random raw reset token (emailed once). */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Hashes a raw reset token (SHA-256) for storage/lookup — raw token never persisted. */
export function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ── JWT helpers ────────────────────────────────────────────────────────────────

/**
 * Issues a signed JWT for a verified user.
 * Payload: userId, email, role.
 */
export function generateJWT(user: Pick<User, 'id' | 'email' | 'role' | 'canAuthorizeJobs' | 'tokenVersion'>): string {
  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    canAuthorizeJobs: user.canAuthorizeJobs,
    tokenVersion: user.tokenVersion,
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Verifies a JWT and returns the decoded payload.
 * Throws JsonWebTokenError or TokenExpiredError on failure.
 */
export function verifyJWT(token: string): jwt.JwtPayload {
  return jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
}
