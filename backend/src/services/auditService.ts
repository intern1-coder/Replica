import { Prisma, AuditAction } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../lib/logger';

export interface AuditLogData {
  entityType: string;
  entityId: string;
  action: AuditAction;
  performedById: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  jobId?: string | null;
}

/**
 * Creates an immutable audit log record.
 * This is "fire and forget" — errors are caught and logged but do not crash
 * the calling mutation. This ensures the app remains stable even if logging fails.
 */
export async function logAudit(data: AuditLogData): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        performedById: data.performedById,
        before: data.before ? (data.before as Prisma.InputJsonValue) : Prisma.DbNull,
        after: data.after ? (data.after as Prisma.InputJsonValue) : Prisma.DbNull,
        jobId: data.jobId || null,
      },
    });
  } catch (err) {
    // We don't want audit log failures to break core flows (e.g. creating a job),
    // so we catch and log as an error.
    logger.error('Failed to write audit log', { error: err, auditData: data });
  }
}
