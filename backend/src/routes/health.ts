import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import logger from '../lib/logger';

const router = Router();

/**
 * GET /api/health
 *
 * Health check used by deployment tooling and monitoring.
 * Pings the database so the response reflects full operational status.
 * Returns 200 when healthy, 503 when the DB is unreachable.
 */
router.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  let dbStatus: 'ok' | 'error' = 'ok';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'error';
    logger.warn('Health check: DB ping failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const healthy = dbStatus === 'ok';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    db: dbStatus,
    responseTime: `${Date.now() - startTime}ms`,
  });
});

export default router;
