/**
 * Shared Prisma selection fragments used across routes/services.
 */

// Excludes soft-deleted engineers from a Job's assignedContractors relation.
// Without this filter, deactivating an engineer (DELETE /api/engineers/:id)
// leaves them visible on every job they were ever assigned to — job details,
// job sheets, and completion reports all read this same relation.
export const ACTIVE_ASSIGNED_CONTRACTORS = {
  where: { deletedAt: null },
  select: { id: true, name: true },
} as const;
