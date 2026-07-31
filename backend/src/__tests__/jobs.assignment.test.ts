import request from 'supertest';
import { mockUser, authHeader } from './testAuth';

// Separate mock representing the interactive-transaction `tx` handle used by
// PATCH /api/jobs/:id — kept distinct from the outer `prisma` mock so tests
// can assert on what happened *inside* the transaction (the version-gated
// updateMany, the conditional relation update, and the final re-read).
const mockTx = {
  job: {
    updateMany: jest.fn(),
    update: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
};

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
    job: { findFirst: jest.fn() },
    engineer: { count: jest.fn() },
    workLog: { groupBy: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(mockTx) : Promise.all(arg))),
  },
}));

import app from '../app';
import prisma from '../lib/prisma';
const mockPrisma = prisma as any;

const PM_USER = mockUser({ id: 'pm-1', role: 'PM' as any });
const AUTH = authHeader(PM_USER);

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const BOB_ID = '22222222-2222-4222-8222-222222222222';
const DAVE_ID = '33333333-3333-4333-8333-333333333333';
const CURRENT_VERSION = 3;

function existingJob(assignedContractors: { id: string; name: string }[]) {
  return {
    id: JOB_ID,
    version: CURRENT_VERSION,
    property: { id: 'prop-1', address: '1 Test St' },
    client: { id: 'client-1', name: 'Test Client' },
    assignedContractors,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findFirst.mockResolvedValue(PM_USER);
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.$transaction.mockImplementation((arg: any) =>
    typeof arg === 'function' ? arg(mockTx) : Promise.all(arg)
  );
  // Default happy path: the version matches, so the compare-and-swap succeeds.
  mockTx.job.updateMany.mockResolvedValue({ count: 1 });
  mockTx.job.findUniqueOrThrow.mockImplementation(() =>
    Promise.resolve({
      id: JOB_ID,
      sequence: 1,
      status: 'TO_BE_CHECKED',
      version: CURRENT_VERSION + 1,
      assignedContractors: [],
    })
  );
});

describe('PATCH /api/jobs/:id — optimistic locking', () => {
  it('requires version in the request body (422 without it)', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([]));

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ description: 'Updated' });

    expect(res.status).toBe(422);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('409s when the submitted version no longer matches (someone else saved first)', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([]));
    mockTx.job.updateMany.mockResolvedValue({ count: 0 }); // compare-and-swap missed

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ version: CURRENT_VERSION, description: 'Updated' });

    expect(res.status).toBe(409);
    expect(res.body.type).toBe('OPTIMISTIC_LOCK_CONFLICT');
    expect(mockTx.job.update).not.toHaveBeenCalled();
  });

  it('succeeds and increments version when the submitted version matches', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([]));

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ version: CURRENT_VERSION, description: 'Updated' });

    expect(res.status).toBe(200);
    const call = mockTx.job.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: JOB_ID, version: CURRENT_VERSION, deletedAt: null });
    expect(call.data.version).toEqual({ increment: 1 });
  });
});

describe('PATCH /api/jobs/:id — assignedContractorIds diff', () => {
  it('blocks unassigning an engineer who has logged hours on the job (422)', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([{ id: BOB_ID, name: 'Bob Builder' }]));
    mockPrisma.workLog.groupBy.mockResolvedValue([{ contractorId: BOB_ID }]);

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ version: CURRENT_VERSION, assignedContractorIds: [] });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Bob Builder/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('disconnects an engineer with no logged hours', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([{ id: BOB_ID, name: 'Bob Builder' }]));
    mockPrisma.workLog.groupBy.mockResolvedValue([]); // no hours for Bob

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ version: CURRENT_VERSION, assignedContractorIds: [] });

    expect(res.status).toBe(200);
    expect(mockTx.job.update).toHaveBeenCalledTimes(1);
    const data = mockTx.job.update.mock.calls[0][0].data;
    expect(data.assignedContractors).toEqual({ connect: [], disconnect: [{ id: BOB_ID }] });
  });

  it('connects a newly-added engineer while leaving the existing one untouched', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([{ id: BOB_ID, name: 'Bob Builder' }]));
    mockPrisma.workLog.groupBy.mockResolvedValue([]);
    mockPrisma.engineer.count.mockResolvedValue(1); // DAVE_ID is a live engineer

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ version: CURRENT_VERSION, assignedContractorIds: [BOB_ID, DAVE_ID] });

    expect(res.status).toBe(200);
    const data = mockTx.job.update.mock.calls[0][0].data;
    expect(data.assignedContractors).toEqual({ connect: [{ id: DAVE_ID }], disconnect: [] });
  });

  it('422s when an added id does not correspond to a live engineer', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([]));
    mockPrisma.workLog.groupBy.mockResolvedValue([]);
    mockPrisma.engineer.count.mockResolvedValue(0); // DAVE_ID not found / soft-deleted

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ version: CURRENT_VERSION, assignedContractorIds: [DAVE_ID] });

    expect(res.status).toBe(422);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not touch assignedContractors when the field is omitted from the request', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([{ id: BOB_ID, name: 'Bob Builder' }]));

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ version: CURRENT_VERSION, description: 'Updated description' });

    expect(res.status).toBe(200);
    expect(mockPrisma.workLog.groupBy).not.toHaveBeenCalled();
    expect(mockTx.job.update).not.toHaveBeenCalled();
  });
});
