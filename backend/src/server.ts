import './config';
import http from 'http';
import app from './app';
import config from './config';
import logger from './lib/logger';
import prisma from './lib/prisma';
import { initSocket } from './lib/socket';
import { startBackupCron } from './services/backupService';

const server = http.createServer(app);

// Attach Socket.io — must be before server.listen()
// Provides live job status, work log, and media upload events to connected PMs.
initSocket(server);

// Start nightly backups
startBackupCron();

// ── Startup ────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    // Verify DB connectivity before accepting traffic.
    // NOTE: Migrations are NEVER auto-applied here — run `npm run prisma:migrate:deploy`
    //       as an explicit, manual step in the deployment process. (Rules.md, TechSpec.md)
    await prisma.$connect();
    logger.info('Database connected');

    server.listen(config.port, () => {
      logger.info('Affinity backend listening', {
        port: config.port,
        env: config.env,
        pid: process.pid,
      });
    });
  } catch (err) {
    logger.error('Failed to start server', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    process.exit(1);
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — initiating graceful shutdown`);

  // Stop accepting new connections; wait for in-flight requests to complete.
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await prisma.$disconnect();
      logger.info('Database disconnected');
    } catch (err) {
      logger.error('Error disconnecting from database', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long (15 seconds)
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15_000).unref();
}

// ── Signal handlers ────────────────────────────────────────────────────────────

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

// Uncaught errors — log fully, then exit and let pm2/systemd restart the process
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

// ── Boot ───────────────────────────────────────────────────────────────────────
void start();
