import { Router, Request, Response, NextFunction } from 'express';
import { param, query } from 'express-validator';
import { Prisma, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requirePermission } from '../middleware/auth';
import { formatJobNumber, getPaginationParams } from '../lib/utils';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('financials:view'));

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Shape returned by the raw SQL P&L query.
 * Prisma raw queries return Decimal as Prisma.Decimal and bigint for
 * PostgreSQL BIGINT/SERIAL columns.
 */
interface PnlRow {
  id: string;
  sequence: bigint;           // autoincrement → bigint from Postgres raw query
  revenue: Prisma.Decimal | null;
  labor_cost: Prisma.Decimal;
  labor_hours: Prisma.Decimal;
  material_cost: Prisma.Decimal;
  /** Only present in the /summary query (needed there for ORDER BY); formatPnlRow recomputes it either way. */
  profit?: Prisma.Decimal | null;
}

// Raw SQL fragment shared by both queries below — the table names here are
// the @@map names ("jobs"/"work_logs" in schema.prisma), NOT the Prisma model
// names ("Job"/"WorkLog"). Kept as a single exported constant so the two
// queries can never drift out of sync with each other or with the schema
// again, and so a test can assert on the text without a live database.
export const PNL_FROM_JOIN_CLAUSE = `
  FROM   "jobs" j
  LEFT JOIN "work_logs" w
         ON w."jobId"      = j."id"
        AND w."deletedAt"  IS NULL
`;

/**
 * Converts a raw P&L row into the API response shape.
 * Profit is computed with Prisma.Decimal and rounded once at the JSON
 * boundary — summing/subtracting as JS floats first (as this used to do)
 * can silently drift a cent or two on ordinary invoice-sized values.
 */
export function formatPnlRow(row: PnlRow) {
  const revenue      = row.revenue ? new Prisma.Decimal(row.revenue) : new Prisma.Decimal(0);
  const laborCost    = new Prisma.Decimal(row.labor_cost);
  const laborHours   = new Prisma.Decimal(row.labor_hours);
  const materialCost = new Prisma.Decimal(row.material_cost);
  const profit       = revenue.minus(laborCost).minus(materialCost);
  return {
    jobNumber:    formatJobNumber(Number(row.sequence)),
    revenue:      Number(revenue.toFixed(2)),
    laborCost:    Number(laborCost.toFixed(2)),
    laborHours:   Number(laborHours.toFixed(2)),
    materialCost: Number(materialCost.toFixed(2)),
    profit:       Number(profit.toFixed(2)),
  };
}

// ── GET /api/pnl/jobs/:jobId ───────────────────────────────────────────────────
// Per-job P&L.
// This is the ONE place raw SQL is used in the codebase. (Rules.md)
// The LEFT JOIN with deleted_at IS NULL ensures soft-deleted work logs are
// excluded from the cost totals — the test suite verifies this behaviour.

router.get(
  '/jobs/:jobId',
  [param('jobId').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await prisma.$queryRaw<PnlRow[]>`
        SELECT
          j."id",
          j."sequence",
          j."quotedValue"                                              AS "revenue",
          COALESCE(SUM(w."hoursWorked" * w."rateApplied"), 0)          AS "labor_cost",
          COALESCE(SUM(w."hoursWorked"), 0)                            AS "labor_hours",
          COALESCE(SUM(w."materialCost"), 0)                           AS "material_cost"
        ${Prisma.raw(PNL_FROM_JOIN_CLAUSE)}
        WHERE  j."id"         = ${req.params['jobId']}
          AND  j."deletedAt" IS NULL
        GROUP  BY j."id", j."sequence", j."quotedValue"
      `;

      if (result.length === 0) {
        res.status(404).json({ error: 'Not Found', message: 'Job not found.' });
        return;
      }

      res.json({ id: result[0].id, ...formatPnlRow(result[0]) });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/pnl/summary?page=1&limit=50 ────────────────────────────────────
// Rolling P&L across all active (non-deleted) jobs, sorted by profit ascending
// (worst-performing first) to surface jobs that are running over budget.

router.get(
  '/summary',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { skip, limit, page } = getPaginationParams(
        req.query as Record<string, string | undefined>
      );

      // Count query (cannot use COUNT with GROUP BY in a simple way, so we use a subquery)
      const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) AS count FROM "jobs" WHERE "deletedAt" IS NULL
      `;
      const total = Number(countResult[0].count);

      const rows = await prisma.$queryRaw<PnlRow[]>`
        SELECT
          j."id",
          j."sequence",
          j."quotedValue"                                              AS "revenue",
          COALESCE(SUM(w."hoursWorked" * w."rateApplied"), 0)          AS "labor_cost",
          COALESCE(SUM(w."hoursWorked"), 0)                            AS "labor_hours",
          COALESCE(SUM(w."materialCost"), 0)                           AS "material_cost",
          j."quotedValue"
            - COALESCE(SUM(w."hoursWorked" * w."rateApplied"), 0)
            - COALESCE(SUM(w."materialCost"), 0)                       AS "profit"
        ${Prisma.raw(PNL_FROM_JOIN_CLAUSE)}
        WHERE  j."deletedAt" IS NULL
        GROUP  BY j."id", j."sequence", j."quotedValue"
        ORDER  BY profit ASC NULLS LAST
        LIMIT  ${limit}
        OFFSET ${skip}
      `;

      res.json({
        data: rows.map((row) => ({ id: row.id, ...formatPnlRow(row) })),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
