import request from 'supertest';
import { Role, JobStatus } from '@prisma/client';
import { mockUser, authHeader } from './testAuth';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
    job: { findMany: jest.fn() },
    auditLog: { findMany: jest.fn() },
    $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg({}) : Promise.all(arg))),
  },
}));

import app from '../app';
import prisma from '../lib/prisma';
const mockPrisma = prisma as any;

const ADMIN_USER = mockUser({ id: 'admin-1', role: Role.ADMIN });
const PM_USER = mockUser({ id: 'pm-1', role: Role.PM });

const NOW = new Date('2026-09-23T12:00:00Z');
const STALE = new Date('2026-09-10T12:00:00Z'); // > 5 days before NOW
const RECENT = new Date('2026-09-21T12:00:00Z'); // 2 days before NOW — not stalled

const ALL_STATUS_KEYS = [
  'TO_BE_CHECKED',
  'CHECKED',
  'QUOTED',
  'AUTHORISED',
  'PENDING_INVOICE',
  'COMPLETED',
  'CANCELLED',
] as const;

function jobs(status: string, n: number, opts: { stale?: boolean; archived?: boolean; updatedAt?: Date } = {}) {
  return Array.from({ length: n }, () => ({
    status,
    updatedAt: opts.updatedAt ?? (opts.stale ? STALE : NOW),
    deletedAt: opts.archived ? STALE : null,
  }));
}

// 12 To Be Checked (2 stale), 6 Quoted (3 stale), 40 Completed, 7 archived.
const JOB_ROWS = [
  ...jobs('TO_BE_CHECKED', 10),
  ...jobs('TO_BE_CHECKED', 2, { stale: true }),
  ...jobs('QUOTED', 3),
  ...jobs('QUOTED', 3, { stale: true }),
  ...jobs('COMPLETED', 40),
  ...jobs('CANCELLED', 0),
  ...jobs('TO_BE_CHECKED', 7, { archived: true }),
];

function mockCounts(updates: any[] = [], rows: any[] = JOB_ROWS) {
  mockPrisma.job.findMany.mockResolvedValueOnce(rows);
  mockPrisma.auditLog.findMany.mockResolvedValueOnce(updates);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findFirst.mockResolvedValue(ADMIN_USER);
});

describe('GET /api/jobs/counts', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/jobs/counts');
    expect(res.status).toBe(401);
  });

  it('returns 403 when jobs:view is revoked via permission override', async () => {
    // applyViewDependencies re-enables view while any jobs mutation remains,
    // so clear every jobs:* key — not just view.
    const DENIED = mockUser({
      id: 'denied-1',
      role: Role.PM,
      permissionOverrides: {
        'jobs:view': false,
        'jobs:create': false,
        'jobs:edit': false,
        'jobs:delete': false,
        'jobs:authorize': false,
        'jobs:complete': false,
      },
    });
    mockPrisma.user.findFirst.mockResolvedValue(DENIED);

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(DENIED));

    expect(res.status).toBe(403);
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
  });

  it('returns zero-filled byStatus with tab math, stalled and archived counts', async () => {
    mockCounts([]);

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.byStatus).toEqual({
      TO_BE_CHECKED: 12,
      CHECKED: 0,
      QUOTED: 6,
      AUTHORISED: 0,
      PENDING_INVOICE: 0,
      COMPLETED: 40,
      CANCELLED: 0,
    });
    expect(res.body.byTab).toEqual({
      active: 18,
      completed: 40,
      cancelled: 0,
      archived: 7,
    });
    // Stalled = active statuses untouched for 5+ days (archived excluded).
    expect(res.body.stalled).toEqual({
      TO_BE_CHECKED: 2,
      CHECKED: 0,
      QUOTED: 3,
      AUTHORISED: 0,
      PENDING_INVOICE: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    });
    expect(res.body.flow7d).toEqual({
      TO_BE_CHECKED: 0,
      CHECKED: 0,
      QUOTED: 0,
      AUTHORISED: 0,
      PENDING_INVOICE: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    });
    expect(res.body.stalledDays).toBe(5);
  });

  it('returns every JobStatus key zero-filled when there are no jobs', async () => {
    mockCounts([], []);

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    for (const key of ALL_STATUS_KEYS) {
      expect(res.body.byStatus[key]).toBe(0);
      expect(res.body.stalled[key]).toBe(0);
      expect(res.body.flow7d[key]).toBe(0);
    }
    expect(res.body.byTab).toEqual({ active: 0, completed: 0, cancelled: 0, archived: 0 });
  });

  it('keeps byTab.active as the sum of non-terminal statuses only', async () => {
    mockCounts(
      [],
      [
        ...jobs('TO_BE_CHECKED', 5),
        ...jobs('CHECKED', 4),
        ...jobs('QUOTED', 3),
        ...jobs('AUTHORISED', 2),
        ...jobs('PENDING_INVOICE', 1),
        ...jobs('COMPLETED', 10),
        ...jobs('CANCELLED', 6),
      ],
    );

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.body.byStatus).toMatchObject({
      TO_BE_CHECKED: 5,
      CHECKED: 4,
      QUOTED: 3,
      AUTHORISED: 2,
      PENDING_INVOICE: 1,
      COMPLETED: 10,
      CANCELLED: 6,
    });
    expect(res.body.byTab.active).toBe(15);
    expect(res.body.byTab.completed).toBe(10);
    expect(res.body.byTab.cancelled).toBe(6);
  });

  it('excludes archived jobs from byStatus and byTab.active', async () => {
    mockCounts(
      [],
      [
        ...jobs('QUOTED', 3),
        ...jobs('QUOTED', 5, { archived: true }),
        ...jobs('COMPLETED', 2, { archived: true }),
      ],
    );

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.body.byStatus.QUOTED).toBe(3);
    expect(res.body.byStatus.COMPLETED).toBe(0);
    expect(res.body.byTab.active).toBe(3);
    expect(res.body.byTab.archived).toBe(7);
  });

  it('never marks COMPLETED or CANCELLED as stalled, even when stale', async () => {
    mockCounts(
      [],
      [
        ...jobs('COMPLETED', 4, { stale: true }),
        ...jobs('CANCELLED', 3, { stale: true }),
        ...jobs('PENDING_INVOICE', 2, { stale: true }),
      ],
    );

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.body.stalled.COMPLETED).toBe(0);
    expect(res.body.stalled.CANCELLED).toBe(0);
    expect(res.body.stalled.PENDING_INVOICE).toBe(2);
    expect(res.body.stalledDays).toBe(5);
  });

  it('does not stall an active job whose updatedAt is inside the window', async () => {
    mockCounts([], jobs('CHECKED', 5, { updatedAt: RECENT }));

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.body.byStatus.CHECKED).toBe(5);
    expect(res.body.stalled.CHECKED).toBe(0);
  });

  it('does not stall archived jobs even when their updatedAt is stale', async () => {
    mockCounts([], jobs('AUTHORISED', 4, { stale: true, archived: true }));

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.body.byStatus.AUTHORISED).toBe(0);
    expect(res.body.stalled.AUTHORISED).toBe(0);
    expect(res.body.byTab.archived).toBe(4);
  });

  it('counts only real status transitions into flow7d', async () => {
    mockCounts([
      { before: { status: 'CHECKED' }, after: { status: 'QUOTED' } },
      { before: { status: 'QUOTED' }, after: { status: 'AUTHORISED' } },
      // Non-status UPDATE (description edit) — must be ignored.
      { before: { status: 'QUOTED' }, after: { status: 'QUOTED' } },
      // Missing before status — must be ignored.
      { before: null, after: { status: 'AUTHORISED' } },
    ]);

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.flow7d.QUOTED).toBe(1);
    expect(res.body.flow7d.AUTHORISED).toBe(1);
    expect(res.body.flow7d.CHECKED).toBe(0);
  });

  it('accumulates repeated transitions into the same flow7d bucket', async () => {
    mockCounts([
      { before: { status: 'TO_BE_CHECKED' }, after: { status: 'CHECKED' } },
      { before: { status: 'CHECKED' }, after: { status: 'CHECKED' } }, // same status — ignored
      { before: { status: 'QUOTED' }, after: { status: 'CHECKED' } },
      { before: { status: 'PENDING_INVOICE' }, after: { status: 'COMPLETED' } },
      { before: { status: 'PENDING_INVOICE' }, after: { status: 'CANCELLED' } },
    ]);

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.body.flow7d.CHECKED).toBe(2);
    expect(res.body.flow7d.COMPLETED).toBe(1);
    expect(res.body.flow7d.CANCELLED).toBe(1);
    expect(res.body.flow7d.QUOTED).toBe(0);
  });

  it('ignores audit rows with a missing or unknown after.status', async () => {
    mockCounts([
      { before: { status: 'CHECKED' }, after: null },
      { before: { status: 'CHECKED' }, after: {} },
      { before: { status: 'CHECKED' }, after: { status: 'NOT_A_STATUS' } },
      { before: {}, after: { status: 'QUOTED' } },
    ]);

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(Object.values(res.body.flow7d).every((n) => n === 0)).toBe(true);
  });

  it('hides archived count from users without jobs:delete', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(PM_USER);
    mockCounts([]);

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(PM_USER));

    expect(res.status).toBe(200);
    expect(res.body.byTab.archived).toBe(0);
    // The rest of the payload is unaffected by the gate.
    expect(res.body.byStatus.QUOTED).toBe(6);
  });

  it('exposes a stable response shape for the Jobs chips / Dashboard pipeline', async () => {
    mockCounts([]);

    const res = await request(app)
      .get('/api/jobs/counts')
      .set('Authorization', authHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.byStatus).sort()).toEqual([...ALL_STATUS_KEYS].sort());
    expect(Object.keys(res.body.stalled).sort()).toEqual([...ALL_STATUS_KEYS].sort());
    expect(Object.keys(res.body.flow7d).sort()).toEqual([...ALL_STATUS_KEYS].sort());
    expect(res.body.byTab).toEqual(
      expect.objectContaining({
        active: expect.any(Number),
        completed: expect.any(Number),
        cancelled: expect.any(Number),
        archived: expect.any(Number),
      }),
    );
    expect(typeof res.body.stalledDays).toBe('number');
    // Consistency: terminal tab totals mirror byStatus.
    expect(res.body.byTab.completed).toBe(res.body.byStatus[JobStatus.COMPLETED]);
    expect(res.body.byTab.cancelled).toBe(res.body.byStatus[JobStatus.CANCELLED]);
  });
});
