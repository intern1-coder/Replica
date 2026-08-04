/**
 * Tests for the global rate limiter (express-rate-limit).
 *
 * Production global limit is 500 requests per user (or IP when unauthenticated)
 * per 15-minute window. supertest sends requests from 127.0.0.1, so
 * unauthenticated requests in this suite share the same IP counter.
 *
 * NOTE: express-rate-limit uses an in-memory store by default that is
 * shared across the entire process lifetime.  Each test suite gets a
 * fresh import because Jest resets module registries between test files,
 * but within this file the counter accumulates across tests — which is
 * exactly what we want here.
 */

import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { GLOBAL_RATE_LIMIT_MAX } from '../middleware/rateLimiter';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

describe('Global rate limiter', () => {
  let app: Express;
  const previousNodeEnv = process.env.NODE_ENV;

  const previousJwtSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.APP_URL = 'https://app.example.com';
    // config/index.ts rejects short/placeholder secrets when env=production
    // — setup.ts's 'test-secret' is intentionally short for every other
    // (non-production-mode) test, so this suite needs its own.
    process.env.JWT_SECRET = 'test-only-production-mode-secret-1234567890';
    jest.resetModules();
    const mod = await import('../app');
    app = mod.default;
  });

  afterAll(() => {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.JWT_SECRET = previousJwtSecret;
    delete process.env.FRONTEND_URL;
    delete process.env.APP_URL;
  });

  function makeToken(userId: string): string {
    return jwt.sign({ userId, tokenVersion: 0 }, process.env.JWT_SECRET!);
  }

  /**
   * Hit the lightweight /api/health endpoint up to the global max.
   * The first MAX must succeed (2xx or any non-429).
   * The next request must be rejected with 429.
   */
  it(`returns 429 after ${GLOBAL_RATE_LIMIT_MAX} unauthenticated requests within the window`, async () => {
    for (let i = 0; i < GLOBAL_RATE_LIMIT_MAX; i++) {
      const res = await request(app).get('/api/health');
      expect(res.status).not.toBe(429);
    }

    const limited = await request(app).get('/api/health');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: 'Too Many Requests' });
  }, 120_000);

  /**
   * Two authenticated users on the same IP each get an independent bucket.
   * Under the old 100/IP limit both would fail after ~100 combined requests;
   * with per-user keys each can exceed the old ceiling without 429.
   */
  it('gives independent buckets per authenticated user on the same IP', async () => {
    const OVER_OLD_LIMIT = 101;
    const tokenA = makeToken('rate-test-user-a');
    const tokenB = makeToken('rate-test-user-b');

    for (let i = 0; i < OVER_OLD_LIMIT; i++) {
      const resA = await request(app)
        .get('/api/health')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resA.status).not.toBe(429);

      const resB = await request(app)
        .get('/api/health')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(resB.status).not.toBe(429);
    }
  }, 120_000);
});
