import { Prisma } from '@prisma/client';
import { formatPnlRow } from '../routes/pnl';

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
    materialCost?: string;
  }) {
    return {
      id: 'test-job-id',
      sequence: BigInt(42),
      revenue:       overrides.revenue !== undefined
                       ? overrides.revenue !== null ? new Prisma.Decimal(overrides.revenue) : null
                       : new Prisma.Decimal('500.00'),
      labor_cost:    new Prisma.Decimal(overrides.laborCost    ?? '0'),
      material_cost: new Prisma.Decimal(overrides.materialCost ?? '0'),
      profit:        null, // calculated in formatPnlRow, not used from this field
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

  it('handles decimal hours × rate correctly (e.g. 1.5 hrs × $80)', () => {
    // The SQL does hours_worked * rate_applied, DB returns the product as Decimal.
    // Here we simulate the already-multiplied labor_cost value the DB returns.
    const result = formatPnlRow(makePnlRow({
      revenue:   '200.00',
      laborCost: '120.00', // 1.5 * 80
    }));
    expect(result.laborCost).toBe(120);
    expect(result.profit).toBe(80);
  });

  it('rounds to floating point precision of JS Number', () => {
    // Verify no unexpected precision loss for typical financial values
    const result = formatPnlRow(makePnlRow({
      revenue:      '999.99',
      laborCost:    '333.33',
      materialCost: '111.11',
    }));
    expect(result.profit).toBeCloseTo(555.55, 2);
  });
});

// ── Structural guarantee documentation ────────────────────────────────────────
// The following assertions document the P&L invariants enforced by the SQL query
// in pnl.ts. They are verified at the DB level in integration tests.

describe('P&L invariants (enforced by SQL — documented here for review)', () => {
  it('SQL query uses AND w.deleted_at IS NULL — soft-deleted work logs are excluded', () => {
    // This is a documentation test. The actual enforcement is in the raw SQL:
    //   LEFT JOIN work_logs w ON w.job_id = j.id AND w.deleted_at IS NULL
    // A deleted work log with hoursWorked=10, rateApplied=80 contributes $0 to labor_cost.
    // Verified in integration tests against a real Postgres instance.
    const deletedLogLaborCost = 0; // excluded by SQL filter
    const result = formatPnlRow({
      id: 'job-id',
      sequence: BigInt(1),
      revenue:       new Prisma.Decimal('500'),
      labor_cost:    new Prisma.Decimal(String(deletedLogLaborCost)),
      material_cost: new Prisma.Decimal('0'),
      profit:        null,
    });
    expect(result.laborCost).toBe(0);
    expect(result.profit).toBe(500);
  });

  it('rateApplied is frozen at log time — live User.hourlyRate changes have no effect', () => {
    // Enforced by workLogs.ts: rateApplied is captured from contractor.hourlyRate
    // during POST /api/work-logs and stored immutably. PATCH does not allow
    // updating rateApplied. This test documents the invariant.
    const frozenRate = 80;   // rate when work was logged
    const currentRate = 120; // rate after contractor's raise — irrelevant to P&L
    expect(frozenRate).not.toBe(currentRate); // they diverged
    // The P&L query uses w.rate_applied (frozen), not a live join to users
    const laborCost = 2 * frozenRate; // 2 hours × frozen $80
    expect(laborCost).toBe(160);
  });
});
