import { PrismaClient } from '@prisma/client';
import logger from './logger';

// ── Prisma singleton ────────────────────────────────────────────────────────────
// connection_limit is controlled via DATABASE_URL (?connection_limit=5).
// server.ts calls prisma.$connect() at startup.
// MIGRATIONS ARE NEVER AUTO-APPLIED HERE — run `prisma migrate deploy` manually.
const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'info',  emit: 'event' },
    { level: 'warn',  emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

// ── Event listeners (route Prisma logs through Winston) ────────────────────────

if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query', (e) => {
    logger.debug('Prisma query', {
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`,
    });
  });
}

prisma.$on('info',  (e) => logger.info('Prisma info',    { message: e.message }));
prisma.$on('warn',  (e) => logger.warn('Prisma warning', { message: e.message }));
prisma.$on('error', (e) => logger.error('Prisma error',  { message: e.message, target: e.target }));

export default prisma;
