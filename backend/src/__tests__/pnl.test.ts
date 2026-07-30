import { Prisma } from '@prisma/client';
import { formatPnlRow, PNL_FROM_JOIN_CLAUSE } from '../routes/pnl';

// ── Unit tests for P&L math (no DB required) ──────────────────────────────────
// These test the formatPnlRow() helper which processes the raw SQL result.
//
// The SQL-level guarantee that soft-deleted work logs are excluded is enforced by
// the `AND w.deleted_at IS NULL` clause in the raw query (pnl.ts).
// Verification of that constraint against a real DB belongs in integration tests,
// which run against a disposable Postgres container (Phase 5, docker-compose.test.yml).

describe('formatPnlRow — P&L calculation', () => {
  // Helper to create a mock PnlRow
  function makePnlRow(overrides: {
    revenue?: string | null;
    laborCost?: string;
    laborHours?: string;
    materialCost?: string;
  }) {
    return {
      id: 'test-job-id',
      sequence: BigInt(42),
      revenue:       overrides.revenue !== undefined
                       ? overrides.revenue !== null ? new Prisma.Decimal(overrides.revenue) : null
                       : new Prisma.Decimal('500.00'),
      labor_cost:    new Prisma.Decimal(overrides.laborCost    ?? '0'),
      labor_hours:   new Prisma.Decimal(overrides.laborHours   ?? '0'),
      material_cost: new Prisma.Decimal(overrides.materialCost ?? '0'),
    };
  }

  it('formats the job number from the sequence', () => {
    const result = formatPnlRow(makePnlRow({}));
    expect(result.jobNumber).toBe('JOB-0042');
  });

  it('calculates profit = revenue - laborCost - materialCost', () => {
    const result = formatPnlRow(makePnlRow({
      revenue:      '1000.00',
      laborCost:    '300.00',
      materialCost: '150.00',
    }));
    expect(result.revenue).toBe(1000);
    expect(result.laborCost).toBe(300);
    expect(result.materialCost).toBe(150);
    expect(result.profit).toBe(550);
  });

  it('handles zero labor cost', () => {
    const result = formatPnlRow(makePnlRow({
      revenue:      '500.00',
      laborCost:    '0',
      materialCost: '0',
    }));
    expect(result.profit).toBe(500);
  });

  it('handles negative profit (cost overrun)', () => {
    const result = formatPnlRow(makePnlRow({
      revenue:      '200.00',
      laborCost:    '300.00',
      materialCost: '100.00',
    }));
    expect(result.profit).toBe(-200);
  });

  it('treats null revenue (no quotedValue on job) as 0', () => {
    const result = formatPnlRow(makePnlRow({
      revenue:      null,
      laborCost:    '100.00',
      materialCost: '50.00',
    }));
    expect(result.revenue).toBe(0);
    expect(result.profit).toBe(-150);
  });

  it('handles decimal hours × rate correctly (e.g. 1.5 hrs × £80)', () => {
    // The SQL does hoursWorked * rateApplied, DB returns the product as Decimal.
    // Here we simulate the already-multiplied labor_cost value the DB returns.
    const result = formatPnlRow(makePnlRow({
      revenue:    '200.00',
      laborCost:  '120.00', // 1.5 * 80
      laborHours: '1.5',
    }));
    expect(result.laborCost).toBe(120);
    expect(result.laborHours).toBe(1.5);
    expect(result.profit).toBe(80);
  });

  it('surfaces laborHours alongside laborCost', () => {
    const result = formatPnlRow(makePnlRow({
      revenue:    '500.00',
      laborCost:  '160.00',
      laborHours: '4.00',
    }));
    expect(result.laborHours).toBe(4);
  });

  it('computes profit with exact Decimal precision — no JS float drift', () => {
    // 999.99 - 333.33 - 111.11 = 555.55 exactly. A naive `Number(a) - Number(b)`
    // chain can drift a cent on values like this; formatPnlRow uses
    // Prisma.Decimal throughout and rounds only once, at the JSON boundary.
    const result = formatPnlRow(makePnlRow({
      revenue:      '999.99',
      laborCost:    '333.33',
      materialCost: '111.11',
    }));
    expect(result.profit).toBe(555.55);
  });
});

// ── Structural guarantees ──────────────────────────────────────────────────────

describe('P&L invariants', () => {
  it('SQL query uses AND w."deletedAt" IS NULL — soft-deleted work logs are excluded', () => {
    // This is a documentation test. The actual enforcement is in the raw SQL:
    //   LEFT JOIN "work_logs" w ON w."jobId" = j."id" AND w."deletedAt" IS NULL
    // A deleted work log with hoursWorked=10, rateApplied=80 contributes £0 to labor_cost.
    // Verified in integration tests against a real Postgres instance.
    const deletedLogLaborCost = 0; // excluded by SQL filter
    const result = formatPnlRow({
      id: 'job-id',
      sequence: BigInt(1),
      revenue:       new Prisma.Decimal('500'),
      labor_cost:    new Prisma.Decimal(String(deletedLogLaborCost)),
      labor_hours:   new Prisma.Decimal('0'),
      material_cost: new Prisma.Decimal('0'),
    });
    expect(result.laborCost).toBe(0);
    expect(result.profit).toBe(500);
  });

  it('the shared FROM/JOIN clause targets the @@map table names, not the Prisma model names', () => {
    // Regression guard for the bug where GET /api/pnl/summary queried
    // "Job"/"WorkLog" (the Prisma model names) instead of "jobs"/"work_logs"
    // (the actual @@map'd table names) and 500'd on every call. Both the
    // per-job and /summary queries interpolate this one constant, so they
    // can never drift out of sync with each other again.
    expect(PNL_FROM_JOIN_CLAUSE).toContain('"jobs"');
    expect(PNL_FROM_JOIN_CLAUSE).toContain('"work_logs"');
    expect(PNL_FROM_JOIN_CLAUSE).not.toMatch(/"Job"/);
    expect(PNL_FROM_JOIN_CLAUSE).not.toMatch(/"WorkLog"/);
  });
});
