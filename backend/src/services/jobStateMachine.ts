import { JobStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import logger from '../lib/logger';
import { OptimisticLockError } from '../middleware/errorHandler';
import { emitJobStatusChanged } from '../lib/socket';

// ── Transition map ─────────────────────────────────────────────────────────────
// Defines every legal state transition (AppFlow.md).
// COMPLETED and CANCELLED are terminal — no outbound transitions.
// CANCELLED is reachable from any non-terminal active state.
//
// Rules.md: every Job status change MUST go through this module.
// No ad-hoc status updates anywhere else in the codebase.

const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  [JobStatus.TO_BE_CHECKED]: [JobStatus.CHECKED,    JobStatus.CANCELLED],
  [JobStatus.CHECKED]:       [JobStatus.QUOTED,     JobStatus.CANCELLED],
  [JobStatus.QUOTED]:        [JobStatus.AUTHORISED, JobStatus.CANCELLED],
  [JobStatus.AUTHORISED]:    [JobStatus.COMPLETED,  JobStatus.CANCELLED],
  [JobStatus.COMPLETED]:     [],   // terminal
  [JobStatus.CANCELLED]:     [],   // terminal
} as const;

// ── Pure helpers (unit-testable without a database) ────────────────────────────

/**
 * Returns true if the transition from → to is allowed by the state machine.
 */
export function isTransitionAllowed(from: JobStatus, to: JobStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] as readonly JobStatus[]).includes(to);
}

/**
 * Returns the list of statuses reachable from a given status.
 * Empty array means the status is terminal.
 */
export function getAllowedTransitions(from: JobStatus): JobStatus[] {
  return [...ALLOWED_TRANSITIONS[from]];
}

// ── Database-dependent transition ──────────────────────────────────────────────

export interface TransitionOptions {
  jobId: string;
  /** The version the caller loaded — used for the optimistic-lock check. */
  currentVersion: number;
  toStatus: JobStatus;
  /** ID of the User performing the action — logged for audit trail. */
  performedById: string;
}

/**
 * Applies a validated, optimistically-locked status transition to a Job.
 *
 * Flow:
 *  1. Load the job — return 404 if not found.
 *  2. Validate the requested transition against the allowed-transitions map.
 *  3. Issue an `updateMany` WHERE id = $1 AND version = $2.
 *     - If 0 rows updated → another session changed the job → OPTIMISTIC_LOCK_CONFLICT.
 *     - If 1 row updated → success; version is incremented.
 *  4. Set completedAt automatically when transitioning to COMPLETED.
 *  5. Return the refreshed job record.
 *
 * The optimistic-lock conflict error type is deliberately distinct from a generic
 * 409 so the frontend can show a "please refresh and retry" prompt rather than
 * a generic error message (Rules.md).
 */
export async function applyTransition({
  jobId,
  currentVersion,
  toStatus,
  performedById,
}: TransitionOptions) {
  // 1. Load the job
  const job = await prisma.job.findFirst({
    where: { id: jobId, deletedAt: null },
    select: { id: true, status: true, version: true },
  });

  if (!job) {
    const err = Object.assign(new Error('Job not found.'), { status: 404, error: 'Not Found' });
    throw err;
  }

  // 1.5 Load the user to check permissions
  const user = await prisma.user.findUnique({
    where: { id: performedById }
  });

  if (!user) {
    const err = Object.assign(new Error('User not found.'), { status: 404, error: 'Not Found' });
    throw err;
  }

  // Enforce Authorize Permission Check
  if (toStatus === JobStatus.AUTHORISED) {
    if (user.role !== 'ADMIN' && user.role !== 'OWNER' && !user.canAuthorizeJobs) {
      const err = Object.assign(
        new Error('You do not have permission to authorize jobs. Please ask an Admin or Approver to authorize this.'),
        { status: 403, error: 'Forbidden' }
      );
      throw err;
    }
  }

  // 2. Validate transition
  if (!isTransitionAllowed(job.status, toStatus)) {
    const allowed = getAllowedTransitions(job.status);
    const err = Object.assign(
      new Error(
        `Transition from ${job.status} to ${toStatus} is not allowed. ` +
          (allowed.length
            ? `Allowed next states: ${allowed.join(', ')}.`
            : 'This job is in a terminal state.')
      ),
      { status: 422, error: 'Invalid Transition' }
    );
    throw err;
  }

  // 3. Optimistic-lock update — only succeeds if version still matches
  const completedAt = toStatus === JobStatus.COMPLETED ? new Date() : undefined;

  const result = await prisma.job.updateMany({
    where: {
      id: jobId,
      version: currentVersion, // The lock — fails silently if version changed
      deletedAt: null,
    },
    data: {
      status: toStatus,
      version: { increment: 1 },
      ...(completedAt !== undefined ? { completedAt } : {}),
    },
  });

  // 4. Zero rows updated = concurrent modification by another session
  if (result.count === 0) {
    const lockErr = Object.assign(new Error('Concurrent modification detected.'), {
      type: 'OPTIMISTIC_LOCK_CONFLICT' as const,
      id: jobId,
    }) as OptimisticLockError;
    throw lockErr;
  }

  logger.info('Job status transition applied', {
    jobId,
    from: job.status,
    to: toStatus,
    newVersion: currentVersion + 1,
    performedById,
  });

  // Broadcast the change to all connected sessions so they can refresh their UI
  // without polling. The new version is included so optimistic-lock holders know
  // their local copy is stale.
  emitJobStatusChanged(jobId, toStatus, currentVersion + 1);

  // 5. Return refreshed job
  return prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      property:          { select: { id: true, address: true } },
      client:            { select: { id: true, name: true } },
      assignedContractor: { select: { id: true, name: true, role: true } },
    },
  });
}
