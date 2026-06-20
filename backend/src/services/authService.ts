import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import config from '../config';
import { User } from '@prisma/client';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

// ── Password helpers ───────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT helpers ────────────────────────────────────────────────────────────────

/**
 * Issues a signed JWT for a verified user.
 * Payload: userId, email, role.
 */
export function generateJWT(user: Pick<User, 'id' | 'email' | 'role'>): string {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role } satisfies JwtPayload,
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'] }
  );
}

/**
 * Verifies a JWT and returns the decoded payload.
 * Throws JsonWebTokenError or TokenExpiredError on failure.
 */
export function verifyJWT(token: string): jwt.JwtPayload {
  return jwt.verify(token, config.jwt.secret) as jwt.JwtPayload;
}
