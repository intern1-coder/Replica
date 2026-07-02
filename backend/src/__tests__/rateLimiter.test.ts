/**
 * Tests for the global rate limiter (express-rate-limit).
 *
 * The global limit is 100 requests per IP per 15-minute window.
 * supertest sends requests from 127.0.0.1, so all requests in this
 * suite share the same IP counter.
 *
 * Requires: supertest (`npm install --save-dev supertest @types/supertest`)
 *
 * NOTE: express-rate-limit uses an in-memory store by default that is
 * shared across the entire process lifetime.  Each test suite gets a
 * fresh import because Jest resets module registries between test files,
 * but within this file the counter accumulates across tests — which is
 * exactly what we want here.
 */

import type { Express } from 'express';
import request from 'supertest';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}));

describe('Global rate limiter', () => {
  let app: Express;
  const previousNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.APP_URL = 'https://app.example.com';
    jest.resetModules();
    const mod = await import('../app');
    app = mod.default;
  });

  afterAll(() => {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.FRONTEND_URL;
    delete process.env.APP_URL;
  });

  /**
   * Hit the lightweight /api/health endpoint 101 times.
   * The first 100 must succeed (2xx or any non-429).
   * The 101st must be rejected with 429.
   *
   * We use a single loop rather than Promise.all to guarantee ordering
   * and to avoid hammering the event loop with 101 concurrent requests.
   */
  it('returns 429 on the 101st request within the window', async () => {
    const MAX = 100;

    for (let i = 0; i < MAX; i++) {
      const res = await request(app).get('/api/health');
      expect(res.status).not.toBe(429);
    }

    const limited = await request(app).get('/api/health');
    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({ error: 'Too Many Requests' });
  }, 30_000);
});
