import { JobStatus, Prisma } from '@prisma/client';
import { formatJobNumber, formatPropertyAddress } from '../lib/utils';
import { summariseWorkLogs } from './workLogSummary';

export interface JobSheetWorkLogInput {
  contractorId: string;
  workDate: Date | string;
  hoursWorked: Prisma.Decimal | string | number;
  rateApplied?: Prisma.Decimal | string | number | null;
  materialCost?: Prisma.Decimal | string | number | null;
  notes: string | null;
  contractor?: { id: string; name: string } | null;
}

export interface JobSheetJobInput {
  sequence: number;
  status: JobStatus;
  scheduledDate: Date | string | null;
  property: { address: string; postcode?: string | null; accessNotes?: string | null } | null;
  tenantSnapshotName: string | null;
  tenantSnapshotPhone: string | null;
  materials: string | null;
  description: string | null;
  diagnosticNotes: string | null;
  quoteLineItems: { description: string }[];
  workLogs: JobSheetWorkLogInput[];
}

export interface ContractorResolutionInput {
  engineerId?: string | null;
  engineerName?: string | null;
}

export interface ContractorResolution {
  contractorName: string;
  /** Non-null only when engineerId was provided and matched an assigned engineer — used to filter workLogs. */
  matchedEngineerId: string | null;
}

export interface ContractorResolutionError {
  error: string;
}

/**
 * Resolves which name prints as "Engineer:" on the sheet, and — when an
 * engineerId was given — which of the job's assigned engineers it matches
 * (so their hours, and only their hours, get filtered onto this sheet).
 * engineerName (free text, no FK) is kept as a legacy override that never
 * filters hours, since it may not correspond to a real Engineer record.
 */
export function resolveJobSheetContractor(
  assignedContractors: { id: string; name: string }[],
  opts: ContractorResolutionInput
): ContractorResolution | ContractorResolutionError {
  if (opts.engineerId) {
    const match = assignedContractors.find((c) => c.id === opts.engineerId);
    if (!match) {
      return { error: 'That engineer is not assigned to this job.' };
    }
    return { contractorName: match.name, matchedEngineerId: match.id };
  }
  if (opts.engineerName) {
    return { contractorName: opts.engineerName, matchedEngineerId: null };
  }
  return {
    contractorName: assignedContractors.length > 0 ? assignedContractors.map((c) => c.name).join(', ') : 'Unassigned',
    matchedEngineerId: null,
  };
}

export interface JobSheetSnapshotOptions {
  contractorName: string;
  /** When set, workLogs are filtered to this one engineer's entries. */
  matchedEngineerId: string | null;
  /** Default true — the sheet's whole reason for existing is showing the engineer their hours. */
  includeHours: boolean;
  /** Default false — rates are margin-sensitive; opt in explicitly, gated server-side on engineer_costs:view. */
  includeRates: boolean;
  diagnosticImages: { src: string; fileName: string }[];
}

/**
 * Builds the Job Sheet PDF snapshot. Pure — no DB or network access — so hours
 * filtering, status formatting, and the includeRates redaction are all
 * directly unit-testable without a live database.
 */
export function buildJobSheetSnapshot(job: JobSheetJobInput, opts: JobSheetSnapshotOptions) {
  const relevantLogs = opts.matchedEngineerId
    ? job.workLogs.filter((wl) => wl.contractorId === opts.matchedEngineerId)
    : job.workLogs;

  const summary = summariseWorkLogs(
    relevantLogs.map((wl) => ({
      contractorId: wl.contractorId,
      hoursWorked: wl.hoursWorked,
      rateApplied: wl.rateApplied ?? 0,
      materialCost: wl.materialCost ?? 0,
    }))
  );

  let scheduledDate = 'TBD';
  let scheduledTime = 'TBD';
  if (job.scheduledDate) {
    const d = new Date(job.scheduledDate);
    scheduledDate = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    scheduledTime = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  const workLogRows = [...relevantLogs]
    .sort((a, b) => new Date(a.workDate).getTime() - new Date(b.workDate).getTime())
    .map((wl) => ({
      date: new Date(wl.workDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      contractorName: wl.contractor?.name || 'Unknown',
      hours: Number(wl.hoursWorked).toFixed(2),
      notes: wl.notes || '',
      ...(opts.includeRates
        ? {
            rate: Number(wl.rateApplied ?? 0).toFixed(2),
            lineTotal: (Number(wl.hoursWorked) * Number(wl.rateApplied ?? 0)).toFixed(2),
          }
        : {}),
    }));

  return {
    jobNumber: formatJobNumber(job.sequence),
    scheduledDate,
    scheduledTime,
    // Always "AUTHORISED", regardless of job.status — the Job Sheet is the
    // work-authorisation document handed to the engineer, so it prints the
    // fact that this work was authorised, not the job's current pipeline
    // stage (which may have since moved to PENDING_INVOICE or COMPLETED by
    // the time the sheet is viewed/regenerated). Confirmed with user.
    status: 'AUTHORISED',
    contractorName: opts.contractorName,
    propertyAddress: job.property ? formatPropertyAddress(job.property) : 'No Property Assigned',
    tenantName: job.tenantSnapshotName || 'N/A',
    tenantPhone: job.tenantSnapshotPhone || '',
    accessNotes: job.property?.accessNotes || '',
    materials: job.materials || 'N/A',
    description: job.description || 'No description provided.',
    diagnosticNotes: job.diagnosticNotes || '',
    // price is intentionally dropped — job_sheet.hbs never renders it, and
    // leaving it in only let it be edited in DocumentEditModal for no effect.
    lineItems: job.quoteLineItems.map((item) => ({ description: item.description })),
    includeHours: opts.includeHours,
    includeRates: opts.includeRates,
    workLogs: opts.includeHours ? workLogRows : [],
    totalHours: summary.totals.hours,
    totalMaterials: summary.totals.materialCost,
    // Columns before "Hours" in the table: Date, Engineer, and Rate when
    // includeRates — Handlebars can't compute this, so it's precomputed here.
    hoursColSpan: opts.includeRates ? 3 : 2,
    ...(opts.includeRates ? { totalLabour: summary.totals.labourCost } : {}),
    diagnosticImages: opts.diagnosticImages,
  };
}
