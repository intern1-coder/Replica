import request from 'supertest';
import { mockUser, authHeader } from './testAuth';
import { ROLE_PRESETS } from '../lib/rolePermissions';

// H4 fix: standalone client/property/tenant directory reads (independent of
// any job assignment) are now gated behind their `*:view` permission, which
// CONTRACTOR no longer holds. Job-embedded PII (property address, tenant
// name/phone, access notes) is untouched — CONTRACTOR still has jobs:view.

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findFirst: jest.fn() },
    client: { findMany: jest.fn(), findFirst: jest.fn() },
    property: { findMany: jest.fn(), findFirst: jest.fn() },
    tenant: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

import app from '../app';
import prisma from '../lib/prisma';
const mockPrisma = prisma as any;

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';

const CONTRACTOR = mockUser({ id: 'contractor-1', role: 'CONTRACTOR' as any });
const PM = mockUser({ id: 'pm-1', role: 'PM' as any });

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.client.findMany.mockResolvedValue([]);
  mockPrisma.client.findFirst.mockResolvedValue({ id: CLIENT_ID });
  mockPrisma.property.findMany.mockResolvedValue([]);
  mockPrisma.property.findFirst.mockResolvedValue({ id: PROPERTY_ID });
  mockPrisma.tenant.findMany.mockResolvedValue([]);
  mockPrisma.tenant.findFirst.mockResolvedValue({ id: TENANT_ID });
});

describe('CONTRACTOR is denied the standalone client/property/tenant directories', () => {
  it('403s on GET /api/clients and GET /api/clients/:id', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(CONTRACTOR);

    const list = await request(app).get('/api/clients').set('Authorization', authHeader(CONTRACTOR));
    expect(list.status).toBe(403);

    const detail = await request(app)
      .get(`/api/clients/${CLIENT_ID}`)
      .set('Authorization', authHeader(CONTRACTOR));
    expect(detail.status).toBe(403);

    expect(mockPrisma.client.findMany).not.toHaveBeenCalled();
  });

  it('403s on GET /api/properties and GET /api/properties/:id', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(CONTRACTOR);

    const list = await request(app).get('/api/properties').set('Authorization', authHeader(CONTRACTOR));
    expect(list.status).toBe(403);

    const detail = await request(app)
      .get(`/api/properties/${PROPERTY_ID}`)
      .set('Authorization', authHeader(CONTRACTOR));
    expect(detail.status).toBe(403);

    expect(mockPrisma.property.findMany).not.toHaveBeenCalled();
  });

  it('403s on GET /api/tenants and GET /api/tenants/:id', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(CONTRACTOR);

    const list = await request(app).get('/api/tenants').set('Authorization', authHeader(CONTRACTOR));
    expect(list.status).toBe(403);

    const detail = await request(app)
      .get(`/api/tenants/${TENANT_ID}`)
      .set('Authorization', authHeader(CONTRACTOR));
    expect(detail.status).toBe(403);

    expect(mockPrisma.tenant.findMany).not.toHaveBeenCalled();
  });
});

describe('PM keeps read access to all three directories (no regression)', () => {
  it('200s on GET /api/clients, /api/properties, /api/tenants', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(PM);

    const clients = await request(app).get('/api/clients').set('Authorization', authHeader(PM));
    expect(clients.status).toBe(200);

    const properties = await request(app).get('/api/properties').set('Authorization', authHeader(PM));
    expect(properties.status).toBe(200);

    const tenants = await request(app).get('/api/tenants').set('Authorization', authHeader(PM));
    expect(tenants.status).toBe(200);
  });
});

describe('CONTRACTOR preset still grants everything needed to work an assigned job', () => {
  it('keeps jobs:view, worklogs:view, media:view, settings:view, engineers:view', () => {
    expect(ROLE_PRESETS.CONTRACTOR).toContain('jobs:view');
    expect(ROLE_PRESETS.CONTRACTOR).toContain('worklogs:view');
    expect(ROLE_PRESETS.CONTRACTOR).toContain('media:view');
    expect(ROLE_PRESETS.CONTRACTOR).toContain('settings:view');
    expect(ROLE_PRESETS.CONTRACTOR).toContain('engineers:view');
  });

  it('drops clients:view, properties:view, tenants:view (the standalone directories)', () => {
    expect(ROLE_PRESETS.CONTRACTOR).not.toContain('clients:view');
    expect(ROLE_PRESETS.CONTRACTOR).not.toContain('properties:view');
    expect(ROLE_PRESETS.CONTRACTOR).not.toContain('tenants:view');
  });
});
