import { Prisma } from '@prisma/client';

export interface WorkLogSummaryInput {
  contractorId: string;
  hoursWorked: Prisma.Decimal | string | number;
  rateApplied: Prisma.Decimal | string | number;
  materialCost: Prisma.Decimal | string | number;
}

export interface ContractorSummary {
  contractorId: string;
  hours: string;
  labourCost: string;
  materialCost: string;
  logCount: number;
}

export interface WorkLogSummary {
  totals: { hours: string; labourCost: string; materialCost: string; logCount: number };
  byContractor: ContractorSummary[];
}

/**
 * Reduces a flat list of work logs into job/engineer totals using
 * Prisma.Decimal throughout. groupBy() can express Σhours and ΣmaterialCost
 * directly but not Σ(hours × rate) — this is the one place that product is
 * computed, so the Job Sheet PDF and the UI read from the same arithmetic
 * and can never disagree. Returns fixed-2 decimal strings, never JS numbers,
 * to avoid float drift on invoice-sized values.
 */
export function summariseWorkLogs(logs: WorkLogSummaryInput[]): WorkLogSummary {
  const perContractor = new Map<
    string,
    { hours: Prisma.Decimal; labourCost: Prisma.Decimal; materialCost: Prisma.Decimal; logCount: number }
  >();

  let totalHours = new Prisma.Decimal(0);
  let totalLabour = new Prisma.Decimal(0);
  let totalMaterial = new Prisma.Decimal(0);

  for (const log of logs) {
    const hours = new Prisma.Decimal(log.hoursWorked);
    const rate = new Prisma.Decimal(log.rateApplied);
    const material = new Prisma.Decimal(log.materialCost);
    const labour = hours.times(rate);

    totalHours = totalHours.plus(hours);
    totalLabour = totalLabour.plus(labour);
    totalMaterial = totalMaterial.plus(material);

    const existing = perContractor.get(log.contractorId) ?? {
      hours: new Prisma.Decimal(0),
      labourCost: new Prisma.Decimal(0),
      materialCost: new Prisma.Decimal(0),
      logCount: 0,
    };
    existing.hours = existing.hours.plus(hours);
    existing.labourCost = existing.labourCost.plus(labour);
    existing.materialCost = existing.materialCost.plus(material);
    existing.logCount += 1;
    perContractor.set(log.contractorId, existing);
  }

  return {
    totals: {
      hours: totalHours.toFixed(2),
      labourCost: totalLabour.toFixed(2),
      materialCost: totalMaterial.toFixed(2),
      logCount: logs.length,
    },
    byContractor: [...perContractor.entries()].map(([contractorId, v]) => ({
      contractorId,
      hours: v.hours.toFixed(2),
      labourCost: v.labourCost.toFixed(2),
      materialCost: v.materialCost.toFixed(2),
      logCount: v.logCount,
    })),
  };
}
