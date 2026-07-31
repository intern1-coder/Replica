import { Role } from '@prisma/client';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
  },
}));

import prisma from '../lib/prisma';
import { resolveAuthenticatedUser } from '../middleware/auth';
const mockPrisma = prisma as any;

const BASE_USER = {
  id: 'u-1',
  email: 'pm@example.com',
  name: 'Test PM',
  role: Role.PM,
  canAuthorizeJobs: false,
  permissionOverrides: null,
  tokenVersion: 3,
};

describe('resolveAuthenticatedUser — shared core of requireAuth, also used by socket auth', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves a valid, current-tokenVersion payload', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(BASE_USER);

    const result = await resolveAuthenticatedUser({ userId: 'u-1', tokenVersion: 3 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe('u-1');
      expect(result.user.role).toBe(Role.PM);
      expect(typeof result.user.can).toBe('function');
    }
    // Only ever queries live (non-soft-deleted) users.
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1', deletedAt: null } })
    );
  });

  it('rejects when the user no longer exists (or is soft-deleted)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const result = await resolveAuthenticatedUser({ userId: 'ghost', tokenVersion: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('rejects a stale tokenVersion — the force-logout mechanism (password reset/change)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(BASE_USER); // tokenVersion 3 in DB

    const result = await resolveAuthenticatedUser({ userId: 'u-1', tokenVersion: 2 }); // old token

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('stale_token');
  });
});
