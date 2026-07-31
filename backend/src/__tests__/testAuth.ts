import jwt from 'jsonwebtoken';
import config from '../config';
import { Role } from '@prisma/client';

/**
 * Shared helpers for route-level (supertest) tests that go through
 * requireAuth — which verifies a real JWT and then loads the user via
 * `prisma.user.findFirst`. Mock that call to resolve `mockUser(...)`, then
 * attach `authHeader(mockUser(...))` to the request.
 */

export function mockUser(overrides: Partial<{
  id: string;
  email: string;
  name: string;
  role: Role;
  canAuthorizeJobs: boolean;
  permissionOverrides: Record<string, boolean> | null;
  tokenVersion: number;
}> = {}) {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    role: Role.PM,
    canAuthorizeJobs: false,
    permissionOverrides: null,
    tokenVersion: 0,
    ...overrides,
  };
}

export function authHeader(user: { id: string; tokenVersion?: number }): string {
  const token = jwt.sign({ userId: user.id, tokenVersion: user.tokenVersion ?? 0 }, config.jwt.secret);
  return `Bearer ${token}`;
}
