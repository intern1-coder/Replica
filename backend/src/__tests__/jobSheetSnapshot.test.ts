import { JobStatus } from '@prisma/client';
import {
  buildJobSheetSnapshot,
  resolveJobSheetContractor,
  type JobSheetJobInput,
} from '../services/jobSheetSnapshot';

const BASE_JOB: JobSheetJobInput = {
  sequence: 42,
  status: JobStatus.PENDING_INVOICE,
  scheduledDate: new Date('2026-07-14T09:00:00.000Z'),
  property: { address: '51 Tolcarne Drive', postcode: 'HA5 2DH', accessNotes: 'Key under the mat' },
  tenantSnapshotName: 'Alice',
  tenantSnapshotPhone: '555-1234',
  materials: 'Paint',
  description: 'Paint the walls',
  diagnosticNotes: 'Needs 2 coats',
  quoteLineItems: [{ description: 'Paint and materials' }],
  workLogs: [
    { contractorId: 'bob', workDate: new Date('2026-07-14T00:00:00Z'), hoursWorked: '4.00', rateApplied: '35.00', materialCost: '0', notes: 'Day 1', contractor: { id: 'bob', name: 'Bob Builder' } },
    { contractorId: 'bob', workDate: new Date('2026-07-15T00:00:00Z'), hoursWorked: '3.50', rateApplied: '35.00', materialCost: '0', notes: 'Day 2', contractor: { id: 'bob', name: 'Bob Builder' } },
    { contractorId: 'dave', workDate: new Date('2026-07-14T00:00:00Z'), hoursWorked: '2.00', rateApplied: '42.00', materialCost: '0', notes: '', contractor: { id: 'dave', name: 'Dave' } },
  ],
};

const ASSIGNED = [
  { id: 'bob', name: 'Bob Builder' },
  { id: 'dave', name: 'Dave' },
];

describe('resolveJobSheetContractor', () => {
  it('resolves by engineerId when it matches an assigned engineer', () => {
    const result = resolveJobSheetContractor(ASSIGNED, { engineerId: 'bob' });
    expect(result).toEqual({ contractorName: 'Bob Builder', matchedEngineerId: 'bob' });
  });

  it('returns an error when engineerId does not match any assigned engineer', () => {
    const result = resolveJobSheetContractor(ASSIGNED, { engineerId: 'not-assigned' });
    expect('error' in result).toBe(true);
  });

  it('falls back to the legacy free-text engineerName override, unfiltered', () => {
    const result = resolveJobSheetContractor(ASSIGNED, { engineerName: 'Someone Else' });
    expect(result).toEqual({ contractorName: 'Someone Else', matchedEngineerId: null });
  });

  it('joins all assigned engineer names when neither is given', () => {
    const result = resolveJobSheetContractor(ASSIGNED, {});
    expect(result).toEqual({ contractorName: 'Bob Builder, Dave', matchedEngineerId: null });
  });

  it('falls back to "Unassigned" when there are no assigned engineers and no override', () => {
    const result = resolveJobSheetContractor([], {});
    expect(result).toEqual({ contractorName: 'Unassigned', matchedEngineerId: null });
  });
});

describe('buildJobSheetSnapshot', () => {
  it('filters workLogs to the matched engineer only', () => {
    const snapshot = buildJobSheetSnapshot(BASE_JOB, {
      contractorName: 'Bob Builder',
      matchedEngineerId: 'bob',
      includeHours: true,
      includeRates: false,
      diagnosticImages: [],
    });
    expect(snapshot.workLogs).toHaveLength(2);
    expect(snapshot.workLogs.every((wl: any) => wl.contractorName === 'Bob Builder')).toBe(true);
  });

  it('sums hours across the filtered logs exactly (4.00 + 3.50 = 7.50)', () => {
    const snapshot = buildJobSheetSnapshot(BASE_JOB, {
      contractorName: 'Bob Builder',
      matchedEngineerId: 'bob',
      includeHours: true,
      includeRates: false,
      diagnosticImages: [],
    });
    expect(snapshot.totalHours).toBe('7.50');
  });

  it('includes every assigned engineer\'s logs when no engineer is matched (engineerName override / "generate for all" without a match)', () => {
    const snapshot = buildJobSheetSnapshot(BASE_JOB, {
      contractorName: 'Bob Builder, Dave',
      matchedEngineerId: null,
      includeHours: true,
      includeRates: false,
      diagnosticImages: [],
    });
    expect(snapshot.workLogs).toHaveLength(3);
    expect(snapshot.totalHours).toBe('9.50');
  });

  it('always prints "AUTHORISED", regardless of the job\'s current status', () => {
    // BASE_JOB.status is PENDING_INVOICE (the job has moved on since the
    // sheet was first authorised) — the sheet still says AUTHORISED, since
    // it documents that the work was authorised, not the job's live stage.
    const snapshot = buildJobSheetSnapshot(BASE_JOB, {
      contractorName: 'Bob Builder',
      matchedEngineerId: 'bob',
      includeHours: true,
      includeRates: false,
      diagnosticImages: [],
    });
    expect(snapshot.status).toBe('AUTHORISED');
  });

  it('omits rate/lineTotal/totalLabour entirely when includeRates is false — not just hidden client-side', () => {
    const snapshot = buildJobSheetSnapshot(BASE_JOB, {
      contractorName: 'Bob Builder',
      matchedEngineerId: 'bob',
      includeHours: true,
      includeRates: false,
      diagnosticImages: [],
    });
    expect(snapshot.workLogs.every((wl: any) => !('rate' in wl) && !('lineTotal' in wl))).toBe(true);
    expect('totalLabour' in snapshot).toBe(false);
  });

  it('includes rate/lineTotal/totalLabour when includeRates is true', () => {
    const snapshot = buildJobSheetSnapshot(BASE_JOB, {
      contractorName: 'Bob Builder',
      matchedEngineerId: 'bob',
      includeHours: true,
      includeRates: true,
      diagnosticImages: [],
    });
    expect(snapshot.workLogs[0]).toMatchObject({ rate: '35.00', lineTotal: '140.00' });
    expect((snapshot as any).totalLabour).toBe('262.50'); // (4 + 3.5) * 35
  });

  it('returns an empty workLogs array when includeHours is false, regardless of matched logs', () => {
    const snapshot = buildJobSheetSnapshot(BASE_JOB, {
      contractorName: 'Bob Builder',
      matchedEngineerId: 'bob',
      includeHours: false,
      includeRates: false,
      diagnosticImages: [],
    });
    expect(snapshot.workLogs).toEqual([]);
  });

  it('drops the dead lineItems.price field — job_sheet.hbs never renders it', () => {
    const snapshot = buildJobSheetSnapshot(BASE_JOB, {
      contractorName: 'Bob Builder',
      matchedEngineerId: 'bob',
      includeHours: true,
      includeRates: false,
      diagnosticImages: [],
    });
    expect(snapshot.lineItems[0]).toEqual({ description: 'Paint and materials' });
    expect('price' in snapshot.lineItems[0]).toBe(false);
  });
});
