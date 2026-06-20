import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { validationResult } from 'express-validator';
import logger from '../lib/logger';

// ── Custom error type for optimistic-lock conflicts ────────────────────────────
// Thrown by services/jobStateMachine.ts — caught here and returned as a
// distinct 409 so the frontend can show a "please refresh" prompt rather
// than a generic error message.
export interface OptimisticLockError extends Error {
  type: 'OPTIMISTIC_LOCK_CONFLICT';
  id: string;
}

// ── Validation middleware ──────────────────────────────────────────────────────

/**
 * Reads express-validator results and returns 422 on failure.
 * Place this after your validator chain on any route that validates input.
 */
export function validate(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({
      error: 'Validation failed',
      details: errors.array(),
    });
    return;
  }
  next();
}

// ── Centralized error handler ──────────────────────────────────────────────────

/**
 * Express 4-argument error handler. Must be the last middleware in app.ts.
 *
 * Translation table (Rules.md):
 *   P2002 → 409  Unique constraint violation
 *   P2003 → 422  Foreign-key constraint violation
 *   P2025 → 404  Record not found
 *   OPTIMISTIC_LOCK_CONFLICT → 409 (distinct type in body)
 *   JWT errors   → 401
 *   Generic      → 500  (stack trace NEVER reaches the client)
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // ── Prisma known request errors ──────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': // Unique constraint
        logger.warn('Unique constraint violation', { code: err.code, meta: err.meta, path: req.path });
        res.status(409).json({
          error: 'Conflict',
          message: 'A record with this value already exists.',
          fields: (err.meta as Record<string, unknown>)?.target,
        });
        return;

      case 'P2003': // Foreign-key constraint
        logger.warn('Foreign key constraint violation', { code: err.code, meta: err.meta, path: req.path });
        res.status(422).json({
          error: 'Unprocessable Entity',
          message: 'Referenced record does not exist.',
          field: (err.meta as Record<string, unknown>)?.field_name,
        });
        return;

      case 'P2025': // Record to update/delete not found
        logger.warn('Record not found (Prisma)', { code: err.code, meta: err.meta, path: req.path });
        res.status(404).json({
          error: 'Not Found',
          message:
            (err.meta as Record<string, unknown>)?.cause as string
            ?? 'The requested record was not found.',
        });
        return;

      case 'P2014': // Required relation violation
        logger.warn('Required relation violation', { code: err.code, meta: err.meta, path: req.path });
        res.status(422).json({
          error: 'Unprocessable Entity',
          message: 'Required relation data is missing or invalid.',
        });
        return;

      default:
        logger.error('Unhandled Prisma known request error', { code: err.code, meta: err.meta, path: req.path });
        res.status(500).json({ error: 'Internal Server Error', message: 'A database error occurred.' });
        return;
    }
  }

  // ── Optimistic locking conflict (jobStateMachine.ts) ──────────────────────────
  if ((err as OptimisticLockError).type === 'OPTIMISTIC_LOCK_CONFLICT') {
    const lockErr = err as OptimisticLockError;
    logger.warn('Optimistic lock conflict', { path: req.path, id: lockErr.id });
    res.status(409).json({
      error: 'Conflict',
      message: 'This record was modified by someone else. Please refresh and try again.',
      type: 'OPTIMISTIC_LOCK_CONFLICT',
    });
    return;
  }

  // ── Prisma validation / connection errors ────────────────────────────────────
  if (err instanceof Prisma.PrismaClientValidationError) {
    logger.warn('Prisma validation error', { message: err.message, path: req.path });
    res.status(422).json({ error: 'Unprocessable Entity', message: 'Invalid data provided.' });
    return;
  }

  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    logger.error('Prisma connection/panic error', { message: err.message });
    res.status(503).json({ error: 'Service Unavailable', message: 'Database is temporarily unavailable.' });
    return;
  }

  // ── JWT errors ────────────────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or malformed authentication token.' });
    return;
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json({ error: 'Unauthorized', message: 'Session has expired. Please log in again.' });
    return;
  }

  // ── Explicit HTTP errors from application code ────────────────────────────────
  // Thrown as: const e = Object.assign(new Error('msg'), { status: 403 }); throw e;
  const errWithStatus = err as Error & { status?: number; error?: string };
  if (errWithStatus.status && errWithStatus.status >= 400 && errWithStatus.status < 500) {
    res.status(errWithStatus.status).json({
      error: errWithStatus.error ?? 'Error',
      message: err.message,
    });
    return;
  }

  // ── Unexpected / unhandled errors ─────────────────────────────────────────────
  // Full details logged server-side; generic message returned to the client.
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected error occurred.' });
}
