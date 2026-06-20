import { Router, Request, Response, NextFunction } from 'express';
import { param, query } from 'express-validator';
import { Prisma, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { validate } from '../middleware/errorHandler';
import { requireAuth, requireRole } from '../middleware/auth';
import { formatJobNumber, getPaginationParams } from '../lib/utils';

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.PM, Role.ADMIN, Role.ACCOUNTS, Role.OWNER));

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
  material_cost: Prisma.Decimal;
  profit: Prisma.Decimal | null;
}

/**
 * Converts a raw P&L row into the API response shape.
 * Converts bigint/Decimal to plain numbers for JSON serialisation.
 */
export function formatPnlRow(row: PnlRow) {
  const revenue      = row.revenue      ? Number(row.revenue)      : 0;
  const laborCost    = Number(row.labor_cost);
  const materialCost = Number(row.material_cost);
  return {
    jobNumber:    formatJobNumber(Number(row.sequence)),
    revenue,
    laborCost,
    materialCost,
    profit:       revenue - laborCost - materialCost,
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
          COALESCE(SUM(w."materialCost"), 0)                           AS "material_cost",
          j."quotedValue"
            - COALESCE(SUM(w."hoursWorked" * w."rateApplied"), 0)
            - COALESCE(SUM(w."materialCost"), 0)                       AS "profit"
        FROM   "Job" j
        LEFT JOIN "WorkLog" w
               ON w."jobId"      = j."id"
              AND w."deletedAt"  IS NULL
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
        SELECT COUNT(*) AS count FROM "Job" WHERE "deletedAt" IS NULL
      `;
      const total = Number(countResult[0].count);

      const rows = await prisma.$queryRaw<PnlRow[]>`
        SELECT
          j."id",
          j."sequence",
          j."quotedValue"                                              AS "revenue",
          COALESCE(SUM(w."hoursWorked" * w."rateApplied"), 0)          AS "labor_cost",
          COALESCE(SUM(w."materialCost"), 0)                           AS "material_cost",
          j."quotedValue"
            - COALESCE(SUM(w."hoursWorked" * w."rateApplied"), 0)
            - COALESCE(SUM(w."materialCost"), 0)                       AS "profit"
        FROM   "Job" j
        LEFT JOIN "WorkLog" w
               ON w."jobId"      = j."id"
              AND w."deletedAt"  IS NULL
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
