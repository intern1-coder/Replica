import { Prisma } from '@prisma/client';
import { summariseWorkLogs } from '../services/workLogSummary';

describe('summariseWorkLogs', () => {
  it('returns zeroed totals for an empty list — not NaN', () => {
    const result = summariseWorkLogs([]);
    expect(result.totals).toEqual({ hours: '0.00', labourCost: '0.00', materialCost: '0.00', logCount: 0 });
    expect(result.byContractor).toEqual([]);
  });

  it('sums hours, labour (hours × rate), and materials for a single engineer', () => {
    const result = summariseWorkLogs([
      { contractorId: 'bob', hoursWorked: '4.00', rateApplied: '35.00', materialCost: '10.00' },
      { contractorId: 'bob', hoursWorked: '2.50', rateApplied: '35.00', materialCost: '0' },
    ]);
    expect(result.totals.hours).toBe('6.50');
    expect(result.totals.labourCost).toBe('227.50'); // 4*35 + 2.5*35
    expect(result.totals.materialCost).toBe('10.00');
    expect(result.totals.logCount).toBe(2);
  });

  it('groups by contractor independently — the "multiple engineers" invariant', () => {
    const result = summariseWorkLogs([
      { contractorId: 'bob', hoursWorked: '4', rateApplied: '35', materialCost: '0' },
      { contractorId: 'dave', hoursWorked: '3', rateApplied: '42', materialCost: '5' },
      { contractorId: 'bob', hoursWorked: '2', rateApplied: '35', materialCost: '0' },
    ]);
    expect(result.totals.hours).toBe('9.00');
    expect(result.totals.logCount).toBe(3);

    const byId = Object.fromEntries(result.byContractor.map((c) => [c.contractorId, c]));
    expect(byId['bob']).toMatchObject({ hours: '6.00', labourCost: '210.00', logCount: 2 });
    expect(byId['dave']).toMatchObject({ hours: '3.00', labourCost: '126.00', materialCost: '5.00', logCount: 1 });
  });

  it('has no float drift across many small fractional logs (3 × 0.1h @ £33.33)', () => {
    // 0.1 * 33.33 = 3.333 in exact decimal; three of them = 9.999. A naive
    // `Number()` reduce is prone to drift here; Prisma.Decimal must not be.
    const result = summariseWorkLogs([
      { contractorId: 'bob', hoursWorked: '0.1', rateApplied: '33.33', materialCost: '0' },
      { contractorId: 'bob', hoursWorked: '0.1', rateApplied: '33.33', materialCost: '0' },
      { contractorId: 'bob', hoursWorked: '0.1', rateApplied: '33.33', materialCost: '0' },
    ]);
    expect(result.totals.hours).toBe('0.30');
    expect(result.totals.labourCost).toBe('10.00'); // 9.999 rounds to 10.00 at 2dp
  });

  it('accepts Prisma.Decimal instances directly (the shape a Prisma findMany returns)', () => {
    const result = summariseWorkLogs([
      {
        contractorId: 'bob',
        hoursWorked: new Prisma.Decimal('4.00'),
        rateApplied: new Prisma.Decimal('35.00'),
        materialCost: new Prisma.Decimal('0'),
      },
    ]);
    expect(result.totals.labourCost).toBe('140.00');
  });
});
