import request from 'supertest';
import { mockUser, authHeader } from './testAuth';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
    engineer: { findMany: jest.fn() },
  },
}));

import app from '../app';
import prisma from '../lib/prisma';
import { ROLE_PRESETS } from '../lib/rolePermissions';
const mockPrisma = prisma as any;

const ENGINEERS_FIXTURE = [
  { id: 'bob', name: 'Bob Builder', phone: null, email: null, hourlyRate: '35.00' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.engineer.findMany.mockImplementation(({ select }: any) =>
    Promise.resolve(
      ENGINEERS_FIXTURE.map((e) => {
        const row: any = { id: e.id, name: e.name, phone: e.phone, email: e.email };
        if (select.hourlyRate) row.hourlyRate = e.hourlyRate;
        return row;
      })
    )
  );
});

describe('GET /api/engineers — rate visibility (engineer_costs:view)', () => {
  it('includes hourlyRate for a user with engineer_costs:view', async () => {
    const user = mockUser({ id: 'pm-1', role: 'PM' as any }); // PM preset includes engineer_costs:view
    mockPrisma.user.findFirst.mockResolvedValue(user);

    const res = await request(app).get('/api/engineers').set('Authorization', authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('hourlyRate');
  });

  it('omits hourlyRate entirely (not null) for a user without engineer_costs:view', async () => {
    const user = mockUser({
      id: 'pm-2',
      role: 'PM' as any,
      permissionOverrides: { 'engineer_costs:view': false } as any,
    });
    mockPrisma.user.findFirst.mockResolvedValue(user);

    const res = await request(app).get('/api/engineers').set('Authorization', authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty('hourlyRate');
  });

  it('403s for a user without engineers:view at all', async () => {
    const user = mockUser({
      id: 'contractor-1',
      role: 'CONTRACTOR' as any,
      permissionOverrides: { 'engineers:view': false } as any,
    });
    mockPrisma.user.findFirst.mockResolvedValue(user);

    const res = await request(app).get('/api/engineers').set('Authorization', authHeader(user));
    expect(res.status).toBe(403);
    expect(mockPrisma.engineer.findMany).not.toHaveBeenCalled();
  });
});

describe('Role presets', () => {
  it('grant ACCOUNTS and CONTRACTOR engineers:view (names already visible via work-log contractor field)', () => {
    expect(ROLE_PRESETS.ACCOUNTS).toContain('engineers:view');
    expect(ROLE_PRESETS.CONTRACTOR).toContain('engineers:view');
  });

  it('does not grant CONTRACTOR engineer_costs:view — rates stay restricted', () => {
    expect(ROLE_PRESETS.CONTRACTOR).not.toContain('engineer_costs:view');
  });

  it('grants ACCOUNTS engineer_costs:view (unchanged pre-existing behaviour)', () => {
    expect(ROLE_PRESETS.ACCOUNTS).toContain('engineer_costs:view');
  });
});
