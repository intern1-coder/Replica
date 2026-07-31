import request from 'supertest';
import { Prisma } from '@prisma/client';
import { mockUser, authHeader } from './testAuth';

// Separate mock client representing the interactive-transaction `tx` handle
// used by POST /api/work-logs — kept distinct from the outer `prisma` mock so
// tests can assert on "did the transaction touch the engineer's rate" without
// it being conflated with calls made outside the transaction.
const mockTx = {
  job: { findFirst: jest.fn(), update: jest.fn() },
  engineer: { findFirst: jest.fn(), update: jest.fn() },
  workLog: { create: jest.fn() },
};

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
    job: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    engineer: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
    workLog: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(mockTx)
    ),
  },
}));

import app from '../app';
import prisma from '../lib/prisma';
const mockPrisma = prisma as any;

const PM_USER = mockUser({ id: 'pm-1', role: 'PM' as any });
const AUTH = authHeader(PM_USER);

// validator.js's isUUID() enforces the RFC4122 variant nibble (8/9/a/b) in
// the third group, not just hex length — plain repeated-digit strings fail it.
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const ENGINEER_ID = '22222222-2222-4222-8222-222222222222';
const WORKLOG_ID = '33333333-3333-4333-8333-333333333333';

function baseWorkLogBody(overrides: Record<string, any> = {}) {
  return {
    jobId: JOB_ID,
    contractorId: ENGINEER_ID,
    hoursWorked: '4.00',
    workDate: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.user.findFirst.mockResolvedValue(PM_USER);
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.$transaction.mockImplementation((arg: any) =>
    Array.isArray(arg) ? Promise.all(arg) : arg(mockTx)
  );
  // Default happy-path transaction fixtures — overridden per test as needed.
  mockTx.job.findFirst.mockResolvedValue({
    assignedContractors: [{ id: ENGINEER_ID }],
  });
  mockTx.engineer.findFirst.mockResolvedValue({
    id: ENGINEER_ID,
    name: 'Bob Builder',
    hourlyRate: new Prisma.Decimal('35.00'),
  });
  mockTx.workLog.create.mockImplementation(({ data }: any) =>
    Promise.resolve({
      id: WORKLOG_ID,
      ...data,
      hoursWorked: new Prisma.Decimal(data.hoursWorked),
      rateApplied: new Prisma.Decimal(data.rateApplied),
      materialCost: new Prisma.Decimal(data.materialCost),
      contractor: { id: ENGINEER_ID, name: 'Bob Builder' },
      loggedBy: { id: PM_USER.id, name: PM_USER.name },
    })
  );
  mockPrisma.job.findUnique.mockResolvedValue({
    assignedContractors: [{ id: ENGINEER_ID, name: 'Bob Builder' }],
  });
});

describe('POST /api/work-logs — validation', () => {
  it('rejects negative hours', async () => {
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody({ hoursWorked: '-2' }));
    expect(res.status).toBe(422);
  });

  it('rejects zero hours (must be > 0)', async () => {
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody({ hoursWorked: '0' }));
    expect(res.status).toBe(422);
  });

  it('rejects hours with 3 decimal places', async () => {
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody({ hoursWorked: '8.125' }));
    expect(res.status).toBe(422);
  });

  it('rejects negative materialCost', async () => {
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody({ materialCost: '-5' }));
    expect(res.status).toBe(422);
  });

  it('rejects negative rateApplied', async () => {
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody({ rateApplied: '-10' }));
    expect(res.status).toBe(422);
  });
});

describe('POST /api/work-logs — rate resolution (defect 1 regression guard)', () => {
  it('never calls engineer.update when updateEngineerDefaultRate is not set', async () => {
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody({ rateApplied: '50.00' }));
    expect(res.status).toBe(201);
    expect(mockTx.engineer.update).not.toHaveBeenCalled();
  });

  it('resolves rateApplied from the engineer default when none is provided', async () => {
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody());
    expect(res.status).toBe(201);
    expect(res.body.rateApplied).toBe('35');
    expect(mockTx.engineer.update).not.toHaveBeenCalled();
  });

  it('calls engineer.update exactly once when updateEngineerDefaultRate is true', async () => {
    const res = await request(app)
      .post('/api/work-logs')
      .set('Authorization', AUTH)
      .send(baseWorkLogBody({ rateApplied: '50.00', updateEngineerDefaultRate: true }));
    expect(res.status).toBe(201);
    expect(mockTx.engineer.update).toHaveBeenCalledTimes(1);
    expect(mockTx.engineer.update).toHaveBeenCalledWith({ where: { id: ENGINEER_ID }, data: { hourlyRate: '50.00' } });
  });

  it('422s when the engineer has no default rate and none is supplied', async () => {
    mockTx.engineer.findFirst.mockResolvedValue({ id: ENGINEER_ID, name: 'Priya', hourlyRate: null });
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody());
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no default rate/i);
    expect(mockTx.workLog.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/work-logs — auto-assignment', () => {
  it('connects the engineer to the job when not already assigned', async () => {
    mockTx.job.findFirst.mockResolvedValue({ assignedContractors: [] });
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody());
    expect(res.status).toBe(201);
    expect(res.body.autoAssigned).toBe(true);
    expect(mockTx.job.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: { assignedContractors: { connect: { id: ENGINEER_ID } } },
    });
  });

  it('does not call job.update when the engineer is already assigned', async () => {
    mockTx.job.findFirst.mockResolvedValue({ assignedContractors: [{ id: ENGINEER_ID }] });
    const res = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody());
    expect(res.status).toBe(201);
    expect(res.body.autoAssigned).toBe(false);
    expect(mockTx.job.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/work-logs — multiple logs append (the reported bug)', () => {
  it('two sequential creates for the same job/engineer/day both call workLog.create — neither overwrites the other', async () => {
    const res1 = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody({ hoursWorked: '4.00' }));
    const res2 = await request(app).post('/api/work-logs').set('Authorization', AUTH).send(baseWorkLogBody({ hoursWorked: '2.50' }));
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(mockTx.workLog.create).toHaveBeenCalledTimes(2);
    expect(mockTx.workLog.create.mock.calls[0][0].data.hoursWorked).toBe('4.00');
    expect(mockTx.workLog.create.mock.calls[1][0].data.hoursWorked).toBe('2.50');
  });
});

describe('PATCH /api/work-logs/:id — rateApplied is frozen', () => {
  beforeEach(() => {
    mockPrisma.workLog.findFirst.mockResolvedValue({
      id: WORKLOG_ID,
      jobId: JOB_ID,
      contractorId: ENGINEER_ID,
      hoursWorked: new Prisma.Decimal('4.00'),
      rateApplied: new Prisma.Decimal('35.00'),
      materialCost: new Prisma.Decimal('0'),
      workDate: new Date('2026-07-14'),
      notes: null,
      contractor: { id: ENGINEER_ID, name: 'Bob Builder' },
      loggedBy: { id: PM_USER.id, name: PM_USER.name },
    });
    mockPrisma.workLog.update.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: WORKLOG_ID,
        jobId: JOB_ID,
        contractorId: ENGINEER_ID,
        hoursWorked: new Prisma.Decimal(data.hoursWorked ?? '4.00'),
        rateApplied: new Prisma.Decimal('35.00'),
        materialCost: new Prisma.Decimal('0'),
        workDate: new Date('2026-07-14'),
        notes: data.notes ?? null,
        contractor: { id: ENGINEER_ID, name: 'Bob Builder' },
        loggedBy: { id: PM_USER.id, name: PM_USER.name },
      })
    );
  });

  it('422s when rateApplied is present in the body, even set to the same value', async () => {
    const res = await request(app)
      .patch(`/api/work-logs/${WORKLOG_ID}`)
      .set('Authorization', AUTH)
      .send({ hoursWorked: '5.00', rateApplied: '35.00' });
    expect(res.status).toBe(422);
    expect(mockPrisma.workLog.update).not.toHaveBeenCalled();
  });

  it('succeeds when rateApplied is absent from the body', async () => {
    const res = await request(app)
      .patch(`/api/work-logs/${WORKLOG_ID}`)
      .set('Authorization', AUTH)
      .send({ hoursWorked: '5.00' });
    expect(res.status).toBe(200);
    expect(mockPrisma.workLog.update).toHaveBeenCalledTimes(1);
    const updateCall = mockPrisma.workLog.update.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('rateApplied');
  });
});
