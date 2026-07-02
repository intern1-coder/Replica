/**
 * Integration-style tests for GET /api/health
 *
 * Requires: supertest (`npm install --save-dev supertest @types/supertest`)
 * Prisma is mocked via jest.mock so no real DB connection is needed.
 */

import request from 'supertest';
import app from '../app';

// Mock the Prisma singleton used by the health route
jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn(),
  },
}));

// Import the mock so we can control its behaviour per test
import prisma from '../lib/prisma';
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('GET /api/health', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with status "ok" when the DB is reachable', async () => {
    // Simulate a successful DB ping
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([{ '?column?': 1 }]);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('responseTime');
  });

  it('returns 503 with status "degraded" when the DB is unreachable', async () => {
    // Simulate a failed DB ping
    (mockPrisma.$queryRaw as jest.Mock).mockRejectedValueOnce(
      new Error('connection refused')
    );

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'error' });
    expect(res.body).toHaveProperty('timestamp');
  });
});
