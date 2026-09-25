/**
 * Seeds realistic dummy data for local development.
 *
 * Usage:
 *   npm.cmd run seed:dummy
 *
 * Safe to re-run: clients/properties/tenants/engineers/jobs are all found-or-
 * created by a stable key (email/address/name/description respectively), so
 * running this again after adding new entries to the lists below only
 * inserts what's missing instead of duplicating everything.
 */
import { JobStatus, PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { normalizeAddress } from '../src/lib/utils';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'DemoUser@123';

const DEMO_USERS: Array<{ email: string; name: string; role: Role }> = [
  { email: 'pm@affinityproperty.co.uk', name: 'Priya Sharma', role: Role.PM },
  { email: 'accounts@affinityproperty.co.uk', name: 'Rachel Okonkwo', role: Role.ACCOUNTS },
  { email: 'contractor@affinityproperty.co.uk', name: 'Dean Walker', role: Role.CONTRACTOR },
];

const CLIENTS = [
  { name: 'Harbour Estates Ltd', email: 'accounts@harbourestates.co.uk', phone: '0207 123 4567' },
  { name: 'Northgate Property Group', email: 'ops@northgatepg.co.uk', phone: '0208 555 0192' },
  { name: 'Affinity Lettings', email: 'maintenance@affinitylettings.co.uk', phone: '0203 148 4476' },
  { name: 'Riverside Block Management', email: 'info@riversideblock.co.uk', phone: '0208 700 2211' },
];

const PROPERTIES = [
  { address: '51 Tolcarne Drive, Pinner', postcode: 'HA5 2DH', accessNotes: 'Keys with concierge', keyLocation: 'Reception desk' },
  { address: '12 Oakwood Avenue, Harrow', postcode: 'HA2 8QR', accessNotes: 'Tenant home after 6pm', keyLocation: 'Lockbox code 4821' },
  { address: 'Flat 4, 88 Station Road, Pinner', postcode: 'HA5 4TH', accessNotes: 'Buzz flat 4', keyLocation: 'Under mat' },
  { address: '22 Meadow Close, Ruislip', postcode: 'HA4 7NB', accessNotes: 'Dog on premises — call first', keyLocation: 'Meter cupboard' },
  { address: '7 Church Lane, Northwood', postcode: 'HA6 1AB', accessNotes: 'Parking on street', keyLocation: 'Agent office' },
  { address: 'Flat 9, Riverside Court, Wembley', postcode: 'HA9 6BX', accessNotes: 'Concierge 8am-8pm, intercom after', keyLocation: 'Concierge desk' },
  { address: '3 Elmfield Road, Pinner', postcode: 'HA5 1LR', accessNotes: 'Side gate code 2024', keyLocation: 'Side gate keysafe' },
];

const ENGINEERS = [
  { name: 'Gabi', email: 'gabi@affinityproperty.co.uk', phone: '07700 900101', hourlyRate: 45 },
  { name: 'Marco', email: 'marco@affinityproperty.co.uk', phone: '07700 900102', hourlyRate: 42 },
  { name: 'Priya', email: 'priya@affinityproperty.co.uk', phone: '07700 900103', hourlyRate: 48 },
  { name: 'Dean', email: 'dean@affinityproperty.co.uk', phone: '07700 900104', hourlyRate: 40 },
  { name: 'Sofia', email: 'sofia@affinityproperty.co.uk', phone: '07700 900105', hourlyRate: 50 },
];

const TENANTS = [
  { name: 'James Mitchell', phone: '07711 222333', email: 'j.mitchell@example.com' },
  { name: 'Sarah Khan', phone: '07722 333444', email: 's.khan@example.com' },
  { name: 'Tom & Lisa Wright', phone: '07733 444555' },
  { name: 'Aisha Patel', phone: '07744 555666', email: 'aisha.p@example.com' },
  { name: 'David Chen', phone: '07755 666777', email: 'd.chen@example.com' },
  { name: 'Fatima Osei', phone: '07766 777888' },
];

interface WorkLogSpec {
  engineerName: string;
  hoursWorked: number;
  /** How many days before "now" this log was worked. */
  daysAgo: number;
  notes?: string;
}

interface JobSpec {
  status: JobStatus;
  description: string;
  quotedValue?: number;
  materials?: string;
  diagnosticNotes?: string;
  completionNotes?: string;
  lineItems?: Array<{ description: string; price: number }>;
  /** Engineers assigned to the job, by name (must match an ENGINEERS entry). Defaults to a single rotating engineer if omitted. */
  engineerNames?: string[];
  /** Explicit work logs to create. Overrides the default single-log behaviour below. */
  workLogs?: WorkLogSpec[];
  /** If set, the job gets a future Job Date this many days out (for the Logistics "Upcoming" view). */
  scheduledInDays?: number;
  /** Backdate updatedAt this many days after create — makes the job count as stalled (5+ days untouched). */
  updatedDaysAgo?: number;
  /** Seed as an archived (soft-deleted) job so the Archived tab has data. */
  archived?: boolean;
  /** Seed a 7-day audit-log status transition INTO this job's status (drives Dashboard "this week" deltas). */
  flowFrom?: JobStatus;
  /** How many days ago the flow transition happened (default 2; must be < 7). */
  flowDaysAgo?: number;
}

const JOB_SPECS: JobSpec[] = [
  {
    status: 'TO_BE_CHECKED',
    description: 'Reported leak under kitchen sink — tenant says slow drip overnight.',
  },
  {
    status: 'CHECKED',
    description: 'Boiler pressure dropping; needs inspection and possible valve replacement.',
    diagnosticNotes: 'Pressure at 0.8 bar. Visible weeping from PRV.',
  },
  {
    status: 'QUOTED',
    description: 'Broken bedroom window latch — security concern.',
    quotedValue: 185,
    lineItems: [
      { description: 'Supply and fit replacement latch set', price: 95 },
      { description: 'Labour — 1.5 hours', price: 90 },
    ],
  },
  {
    status: 'AUTHORISED',
    description: 'Replace faulty smoke alarm and test all units in flat.',
    quotedValue: 220,
    materials: '2x mains smoke alarms, batteries',
    lineItems: [
      { description: 'Smoke alarm units x2', price: 80 },
      { description: 'Labour and testing', price: 140 },
    ],
    scheduledInDays: 2,
  },
  {
    status: 'PENDING_INVOICE',
    description: 'Unblock ensuite shower drain and reseal tray.',
    quotedValue: 160,
    completionNotes: 'Drain cleared, tray resealed, tested OK.',
    lineItems: [
      { description: 'Drain clearance and reseal', price: 160 },
    ],
  },
  {
    status: 'COMPLETED',
    description: 'Repair cracked plaster and touch-up paint in hallway.',
    quotedValue: 275,
    completionNotes: 'Plaster made good, two coats emulsion applied.',
    lineItems: [
      { description: 'Plaster repair and paint', price: 275 },
    ],
  },
  {
    status: 'COMPLETED',
    description: 'Annual gas safety check and certificate.',
    quotedValue: 95,
    completionNotes: 'CP12 issued, no defects noted.',
    lineItems: [
      { description: 'Gas safety inspection', price: 95 },
    ],
  },
  {
    status: 'CANCELLED',
    description: 'Tenant reported no heating — cancelled after tenant fixed thermostat.',
    diagnosticNotes: 'Tenant reset programmer before visit.',
  },
  // ── Multi-engineer scenario — mirrors the real Marco/Priya case this
  // session's engineer-hours work was built and tested against. ──
  {
    status: 'AUTHORISED',
    description: 'Full bathroom refit — strip out, replastering, new suite and tiling.',
    quotedValue: 1450,
    materials: 'Suite, tiles, adhesive, sealant — supplied by client',
    lineItems: [
      { description: 'Strip out and disposal', price: 220 },
      { description: 'Replastering', price: 380 },
      { description: 'Supply and fit new suite', price: 450 },
      { description: 'Tiling and sealing', price: 400 },
    ],
    engineerNames: ['Marco', 'Priya'],
    workLogs: [
      { engineerName: 'Marco', hoursWorked: 6, daysAgo: 3, notes: 'Strip out and disposal, first fix plumbing.' },
      { engineerName: 'Priya', hoursWorked: 8, daysAgo: 3, notes: 'Replastering — first coat.' },
      { engineerName: 'Priya', hoursWorked: 5.5, daysAgo: 2, notes: 'Replastering — second coat and finish.' },
      { engineerName: 'Marco', hoursWorked: 7, daysAgo: 1, notes: 'Suite fitted, tiling started.' },
    ],
  },
  // ── Same engineer, multiple logs across different days — exercises the
  // "add a second log without overwriting the first" flow directly. ──
  {
    status: 'PENDING_INVOICE',
    description: 'Communal garden clearance and fence repair, three visits.',
    quotedValue: 540,
    completionNotes: 'All green waste removed, fence panels replaced, gate rehung.',
    lineItems: [
      { description: 'Garden clearance and green waste removal', price: 220 },
      { description: 'Fence panel replacement x3', price: 240 },
      { description: 'Gate repair', price: 80 },
    ],
    engineerNames: ['Dean'],
    workLogs: [
      { engineerName: 'Dean', hoursWorked: 4, daysAgo: 6, notes: 'Clearance and green waste — day 1.' },
      { engineerName: 'Dean', hoursWorked: 5, daysAgo: 4, notes: 'Fence panels replaced — day 2.' },
      { engineerName: 'Dean', hoursWorked: 2.5, daysAgo: 2, notes: 'Gate rehung, snagging — day 3.' },
    ],
  },
  // ── Booked ahead, nothing logged yet — populates Logistics "Upcoming". ──
  {
    status: 'AUTHORISED',
    description: 'PAT testing and electrical spot-checks across communal areas.',
    quotedValue: 310,
    lineItems: [
      { description: 'PAT testing — communal appliances', price: 130 },
      { description: 'Electrical spot-checks and certificate', price: 180 },
    ],
    engineerNames: ['Sofia'],
    scheduledInDays: 5,
  },
  {
    status: 'COMPLETED',
    description: 'Replace consumer unit to current wiring regs.',
    quotedValue: 620,
    completionNotes: 'New 18th Edition consumer unit fitted and certified.',
    lineItems: [
      { description: 'Consumer unit and RCBOs', price: 260 },
      { description: 'Labour, testing and certification', price: 360 },
    ],
    engineerNames: ['Sofia'],
    workLogs: [
      { engineerName: 'Sofia', hoursWorked: 7, daysAgo: 9, notes: 'Consumer unit replaced and tested.' },
    ],
  },
  // ── Pipeline-count demo data: status spread + stalled (updatedAt 5+ days)
  // so the Jobs chips / Dashboard bars and "untouched" callout have signal. ──
  {
    status: 'TO_BE_CHECKED',
    description: 'Tenant reports damp patch spreading behind wardrobe.',
    updatedDaysAgo: 8,
  },
  {
    status: 'TO_BE_CHECKED',
    description: 'Intercom buzzer not working at communal entrance.',
    updatedDaysAgo: 6,
  },
  {
    status: 'CHECKED',
    description: 'Shower mixer tap dripping — inspected, awaiting quote.',
    updatedDaysAgo: 7,
    diagnosticNotes: 'Ceramic cartridge worn; needs replacement.',
  },
  {
    status: 'QUOTED',
    description: 'Replace cracked shower screen — quote awaiting approval.',
    quotedValue: 240,
    updatedDaysAgo: 9,
  },
  {
    status: 'QUOTED',
    description: 'Regrout bathroom floor tiles — quote sent last week.',
    quotedValue: 320,
    updatedDaysAgo: 6,
  },
  {
    status: 'AUTHORISED',
    description: 'Fix leaking gutter section at rear elevation.',
    quotedValue: 190,
    updatedDaysAgo: 7,
  },
  {
    status: 'PENDING_INVOICE',
    description: 'Replace hallway light fittings x3 — work done, invoice pending.',
    quotedValue: 150,
    updatedDaysAgo: 10,
    completionNotes: 'Three fittings replaced and tested.',
  },
  {
    status: 'TO_BE_CHECKED',
    description: 'Blocked WC on first floor — urgent callout.',
  },
  {
    status: 'TO_BE_CHECKED',
    description: 'Front door lock stiff — tenant requesting a service.',
  },
  {
    status: 'CHECKED',
    description: 'Dishwasher not draining — checked, parts on order.',
    diagnosticNotes: 'Drain pump impeller fractured.',
  },
  {
    status: 'QUOTED',
    description: 'Repaint master bedroom after water stain.',
    quotedValue: 410,
    flowFrom: 'CHECKED',
    flowDaysAgo: 3,
  },
  {
    status: 'QUOTED',
    description: 'Supply and fit new letterbox and escutcheon.',
    quotedValue: 95,
    flowFrom: 'CHECKED',
    flowDaysAgo: 1,
  },
  {
    status: 'AUTHORISED',
    description: 'Emergency board-up after broken kitchen window.',
    quotedValue: 275,
    flowFrom: 'QUOTED',
    flowDaysAgo: 2,
  },
  {
    status: 'AUTHORISED',
    description: 'Replace bathroom extractor fan with timer unit.',
    quotedValue: 145,
    flowFrom: 'QUOTED',
    flowDaysAgo: 4,
  },
  {
    status: 'PENDING_INVOICE',
    description: 'Oven thermostat replacement — completed, ready to invoice.',
    quotedValue: 210,
    flowFrom: 'AUTHORISED',
    flowDaysAgo: 2,
    completionNotes: 'Thermostat replaced, oven tested to spec.',
  },
  {
    status: 'COMPLETED',
    description: 'Fit new mains smoke alarm in hallway — signed off.',
    quotedValue: 75,
    flowFrom: 'PENDING_INVOICE',
    flowDaysAgo: 3,
    completionNotes: 'Alarm fitted and tested.',
  },
  {
    status: 'COMPLETED',
    description: 'Tap replacement in utility room — signed off.',
    quotedValue: 130,
    flowFrom: 'PENDING_INVOICE',
    flowDaysAgo: 5,
    completionNotes: 'Quarter-turn tap fitted, no leaks.',
  },
  {
    status: 'CANCELLED',
    description: 'Loft clearance job — client withdrew after survey.',
    flowFrom: 'QUOTED',
    flowDaysAgo: 4,
  },
  // ── Archived (soft-deleted) jobs — populate the Archived tab. ──
  {
    status: 'TO_BE_CHECKED',
    description: 'Duplicate job raised in error — archived.',
    archived: true,
  },
  {
    status: 'COMPLETED',
    description: 'Superseded maintenance job — archived after merge.',
    quotedValue: 110,
    archived: true,
    completionNotes: 'Merged into a later job.',
  },
];

async function upsertClient(spec: (typeof CLIENTS)[number]) {
  const existing = await prisma.client.findFirst({
    where: { email: spec.email, deletedAt: null },
  });
  if (existing) return existing;
  return prisma.client.create({ data: spec });
}

async function upsertEngineer(spec: (typeof ENGINEERS)[number]) {
  const existing = await prisma.engineer.findFirst({
    where: { name: spec.name, deletedAt: null },
  });
  if (existing) return existing;
  return prisma.engineer.create({ data: spec });
}

async function upsertDemoUsers(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const spec of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: { name: spec.name, role: spec.role, passwordHash, deletedAt: null },
      create: { ...spec, passwordHash, hourlyRate: 0 },
      select: { email: true, role: true },
    });
    console.log(`✓ demo ${user.role}: ${user.email} / ${DEMO_PASSWORD}`);
  }
}

async function main() {
  console.log('Seeding dummy data...');

  await upsertDemoUsers();

  const loggedBy =
    (await prisma.user.findFirst({ where: { role: 'PM', deletedAt: null } })) ??
    (await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', deletedAt: null } })) ??
    (await prisma.user.findFirst({ where: { deletedAt: null } }));

  if (!loggedBy) {
    throw new Error('No users found — run bootstrap:users first.');
  }

  await prisma.setting.upsert({
    where: { key: 'vat_rate' },
    create: { key: 'vat_rate', value: '0.2' },
    update: {},
  });

  const clients = await Promise.all(CLIENTS.map(upsertClient));
  const engineers = await Promise.all(ENGINEERS.map(upsertEngineer));
  const engineersByName = new Map(engineers.map((e) => [e.name, e]));

  const properties = [];
  for (const spec of PROPERTIES) {
    const normalizedAddress = normalizeAddress(`${spec.address}, ${spec.postcode}`);
    const existing = await prisma.property.findFirst({
      where: { normalizedAddress, deletedAt: null },
    });
    if (existing) {
      properties.push(existing);
      continue;
    }
    properties.push(
      await prisma.property.create({
        data: {
          address: spec.address,
          postcode: spec.postcode,
          normalizedAddress,
          accessNotes: spec.accessNotes,
          keyLocation: spec.keyLocation,
          currentClientId: clients[properties.length % clients.length].id,
        },
      })
    );
  }

  const tenants = [];
  for (let i = 0; i < TENANTS.length; i++) {
    const spec = TENANTS[i];
    const property = properties[i % properties.length];
    const client = clients[i % clients.length];
    const existing = await prisma.tenant.findFirst({
      where: { name: spec.name, deletedAt: null },
    });
    if (existing) {
      tenants.push(existing);
      continue;
    }
    tenants.push(
      await prisma.tenant.create({
        data: {
          ...spec,
          propertyId: property.id,
          lastPropertyId: property.id,
          lastClientId: client.id,
        },
      })
    );
  }

  const now = Date.now();
  let createdJobs = 0;
  let skippedJobs = 0;

  for (let i = 0; i < JOB_SPECS.length; i++) {
    const spec = JOB_SPECS[i];

    // Idempotent per-job: description text is unique across JOB_SPECS, so
    // re-running the script after adding new specs only creates the new
    // ones instead of re-inserting (and duplicating) everything. Includes
    // archived jobs (deletedAt set) so re-runs don't duplicate them.
    const existingJob = await prisma.job.findFirst({
      where: { description: spec.description },
    });
    if (existingJob) {
      skippedJobs++;
      continue;
    }

    const property = properties[i % properties.length];
    const client = clients[i % clients.length];
    const tenant = tenants[i % tenants.length];
    const defaultEngineer = engineers[i % engineers.length];
    const jobEngineers = spec.engineerNames
      ? spec.engineerNames.map((name) => engineersByName.get(name)).filter((e): e is NonNullable<typeof e> => !!e)
      : [defaultEngineer];

    const daysAgo = i * 3;
    const createdAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000);

    const job = await prisma.job.create({
      data: {
        propertyId: property.id,
        clientId: client.id,
        tenantId: tenant.id,
        tenantSnapshotName: tenant.name,
        tenantSnapshotPhone: tenant.phone,
        status: spec.status,
        description: spec.description,
        diagnosticNotes: spec.diagnosticNotes,
        completionNotes: spec.completionNotes,
        materials: spec.materials,
        quotedValue: spec.quotedValue,
        createdAt,
        scheduledDate: spec.scheduledInDays !== undefined
          ? new Date(now + spec.scheduledInDays * 24 * 60 * 60 * 1000)
          : spec.status === 'AUTHORISED'
          ? new Date(now + 2 * 24 * 60 * 60 * 1000)
          : undefined,
        completedAt:
          spec.status === 'COMPLETED' || spec.status === 'PENDING_INVOICE'
            ? new Date(createdAt.getTime() + 2 * 24 * 60 * 60 * 1000)
            : undefined,
        deletedAt: spec.archived ? new Date(now - 3 * 24 * 60 * 60 * 1000) : null,
        assignedContractors: { connect: jobEngineers.map((e) => ({ id: e.id })) },
      },
    });

    // Stalled demo: make the job look untouched for N days (updatedAt drives
    // the stalled count in GET /api/jobs/counts).
    if (spec.updatedDaysAgo !== undefined) {
      const backdated = new Date(now - spec.updatedDaysAgo * 24 * 60 * 60 * 1000);
      await prisma.$executeRaw`UPDATE jobs SET "updatedAt" = ${backdated} WHERE id = ${job.id}`;
    }

    // Flow demo: a recent status-change audit row so the Dashboard pipeline
    // shows "↑N this week" deltas (flow7d diffs before.status vs after.status).
    if (spec.flowFrom && !spec.archived) {
      const existingFlow = await prisma.auditLog.findFirst({
        where: { jobId: job.id, action: 'UPDATE', entityType: 'Job' },
      });
      if (!existingFlow) {
        await prisma.auditLog.create({
          data: {
            entityType: 'Job',
            entityId: job.id,
            action: 'UPDATE',
            performedById: loggedBy.id,
            before: { status: spec.flowFrom },
            after: { status: spec.status },
            jobId: job.id,
            createdAt: new Date(now - (spec.flowDaysAgo ?? 2) * 24 * 60 * 60 * 1000),
          },
        });
      }
    }

    if (spec.lineItems?.length) {
      await prisma.jobQuoteLineItem.createMany({
        data: spec.lineItems.map((item) => ({
          jobId: job.id,
          description: item.description,
          price: item.price,
        })),
      });
    }

    if (spec.workLogs?.length) {
      for (const log of spec.workLogs) {
        const engineer = engineersByName.get(log.engineerName);
        if (!engineer) continue;
        await prisma.workLog.create({
          data: {
            jobId: job.id,
            contractorId: engineer.id,
            loggedById: loggedBy.id,
            hoursWorked: log.hoursWorked,
            rateApplied: engineer.hourlyRate ?? 45,
            workDate: new Date(now - log.daysAgo * 24 * 60 * 60 * 1000),
            notes: log.notes,
          },
        });
      }
    } else if (['AUTHORISED', 'PENDING_INVOICE', 'COMPLETED'].includes(spec.status)) {
      // Default single-visit log for specs that don't define explicit workLogs.
      await prisma.workLog.create({
        data: {
          jobId: job.id,
          contractorId: defaultEngineer.id,
          loggedById: loggedBy.id,
          hoursWorked: 2.5,
          rateApplied: defaultEngineer.hourlyRate ?? 45,
          workDate: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
          notes: 'Initial visit — work carried out as quoted.',
        },
      });
    }

    createdJobs++;
  }

  console.log(`Created ${createdJobs} job(s), skipped ${skippedJobs} already-seeded job(s).`);

  console.log('Dummy data ready:');
  console.log(`  Clients:    ${clients.length}`);
  console.log(`  Properties: ${properties.length}`);
  console.log(`  Tenants:    ${tenants.length}`);
  console.log(`  Engineers:  ${engineers.length}`);
  console.log(`  Jobs:       ${await prisma.job.count({ where: { deletedAt: null } })}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
