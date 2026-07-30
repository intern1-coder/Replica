import request from 'supertest';
import { mockUser, authHeader } from './testAuth';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
    job: { findFirst: jest.fn(), update: jest.fn() },
    engineer: { count: jest.fn() },
    workLog: { groupBy: jest.fn() },
    auditLog: { create: jest.fn() },
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

function existingJob(assignedContractors: { id: string; name: string }[]) {
  return {
    id: JOB_ID,
    property: { id: 'prop-1', address: '1 Test St' },
    client: { id: 'client-1', name: 'Test Client' },
    assignedContractors,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findFirst.mockResolvedValue(PM_USER);
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.job.update.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: JOB_ID, ...data, sequence: 1, status: 'TO_BE_CHECKED', assignedContractors: [] })
  );
});

describe('PATCH /api/jobs/:id — assignedContractorIds diff', () => {
  it('blocks unassigning an engineer who has logged hours on the job (422)', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([{ id: BOB_ID, name: 'Bob Builder' }]));
    mockPrisma.workLog.groupBy.mockResolvedValue([{ contractorId: BOB_ID }]);

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ assignedContractorIds: [] });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Bob Builder/);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  it('disconnects an engineer with no logged hours', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([{ id: BOB_ID, name: 'Bob Builder' }]));
    mockPrisma.workLog.groupBy.mockResolvedValue([]); // no hours for Bob

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ assignedContractorIds: [] });

    expect(res.status).toBe(200);
    expect(mockPrisma.job.update).toHaveBeenCalledTimes(1);
    const data = mockPrisma.job.update.mock.calls[0][0].data;
    expect(data.assignedContractors).toEqual({ connect: [], disconnect: [{ id: BOB_ID }] });
  });

  it('connects a newly-added engineer while leaving the existing one untouched', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([{ id: BOB_ID, name: 'Bob Builder' }]));
    mockPrisma.workLog.groupBy.mockResolvedValue([]);
    mockPrisma.engineer.count.mockResolvedValue(1); // DAVE_ID is a live engineer

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ assignedContractorIds: [BOB_ID, DAVE_ID] });

    expect(res.status).toBe(200);
    const data = mockPrisma.job.update.mock.calls[0][0].data;
    expect(data.assignedContractors).toEqual({ connect: [{ id: DAVE_ID }], disconnect: [] });
  });

  it('422s when an added id does not correspond to a live engineer', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([]));
    mockPrisma.workLog.groupBy.mockResolvedValue([]);
    mockPrisma.engineer.count.mockResolvedValue(0); // DAVE_ID not found / soft-deleted

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ assignedContractorIds: [DAVE_ID] });

    expect(res.status).toBe(422);
    expect(mockPrisma.job.update).not.toHaveBeenCalled();
  });

  it('does not touch assignedContractors when the field is omitted from the request', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(existingJob([{ id: BOB_ID, name: 'Bob Builder' }]));

    const res = await request(app)
      .patch(`/api/jobs/${JOB_ID}`)
      .set('Authorization', AUTH)
      .send({ description: 'Updated description' });

    expect(res.status).toBe(200);
    expect(mockPrisma.workLog.groupBy).not.toHaveBeenCalled();
    const data = mockPrisma.job.update.mock.calls[0][0].data;
    expect(data.assignedContractors).toBeUndefined();
  });
});
