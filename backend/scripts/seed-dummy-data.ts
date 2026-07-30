/**
 * Seeds realistic dummy data for local development.
 *
 * Usage:
 *   npm.cmd run seed:dummy
 */
import { JobStatus, PrismaClient } from '@prisma/client';
import { normalizeAddress } from '../src/lib/utils';

const prisma = new PrismaClient();

const CLIENTS = [
  { name: 'Harbour Estates Ltd', email: 'accounts@harbourestates.co.uk', phone: '0207 123 4567' },
  { name: 'Northgate Property Group', email: 'ops@northgatepg.co.uk', phone: '0208 555 0192' },
  { name: 'Affinity Lettings', email: 'maintenance@affinitylettings.co.uk', phone: '0203 148 4476' },
];

const PROPERTIES = [
  { address: '51 Tolcarne Drive, Pinner', postcode: 'HA5 2DH', accessNotes: 'Keys with concierge', keyLocation: 'Reception desk' },
  { address: '12 Oakwood Avenue, Harrow', postcode: 'HA2 8QR', accessNotes: 'Tenant home after 6pm', keyLocation: 'Lockbox code 4821' },
  { address: 'Flat 4, 88 Station Road, Pinner', postcode: 'HA5 4TH', accessNotes: 'Buzz flat 4', keyLocation: 'Under mat' },
  { address: '22 Meadow Close, Ruislip', postcode: 'HA4 7NB', accessNotes: 'Dog on premises — call first', keyLocation: 'Meter cupboard' },
  { address: '7 Church Lane, Northwood', postcode: 'HA6 1AB', accessNotes: 'Parking on street', keyLocation: 'Agent office' },
];

const ENGINEERS = [
  { name: 'Gabi', email: 'gabi@affinityproperty.co.uk', phone: '07700 900101', hourlyRate: 45 },
  { name: 'Marco', email: 'marco@affinityproperty.co.uk', phone: '07700 900102', hourlyRate: 42 },
  { name: 'Priya', email: 'priya@affinityproperty.co.uk', phone: '07700 900103', hourlyRate: 48 },
];

const TENANTS = [
  { name: 'James Mitchell', phone: '07711 222333', email: 'j.mitchell@example.com' },
  { name: 'Sarah Khan', phone: '07722 333444', email: 's.khan@example.com' },
  { name: 'Tom & Lisa Wright', phone: '07733 444555' },
  { name: 'Aisha Patel', phone: '07744 555666', email: 'aisha.p@example.com' },
];

const JOB_SPECS: Array<{
  status: JobStatus;
  description: string;
  quotedValue?: number;
  materials?: string;
  diagnosticNotes?: string;
  completionNotes?: string;
  lineItems?: Array<{ description: string; price: number }>;
}> = [
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

async function main() {
  console.log('Seeding dummy data...');

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

  const existingJobCount = await prisma.job.count({ where: { deletedAt: null } });
  if (existingJobCount >= JOB_SPECS.length) {
    console.log(`Skipping jobs — ${existingJobCount} job(s) already exist.`);
  } else {
    const now = Date.now();
    let createdJobs = 0;

    for (let i = 0; i < JOB_SPECS.length; i++) {
      const spec = JOB_SPECS[i];
      const property = properties[i % properties.length];
      const client = clients[i % clients.length];
      const tenant = tenants[i % tenants.length];
      const engineer = engineers[i % engineers.length];
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
          scheduledDate:
            spec.status === 'AUTHORISED'
              ? new Date(now + 2 * 24 * 60 * 60 * 1000)
              : undefined,
          completedAt:
            spec.status === 'COMPLETED' || spec.status === 'PENDING_INVOICE'
              ? new Date(createdAt.getTime() + 2 * 24 * 60 * 60 * 1000)
              : undefined,
          assignedContractors: { connect: [{ id: engineer.id }] },
        },
      });

      if (spec.lineItems?.length) {
        await prisma.jobQuoteLineItem.createMany({
          data: spec.lineItems.map((item) => ({
            jobId: job.id,
            description: item.description,
            price: item.price,
          })),
        });
      }

      if (['AUTHORISED', 'PENDING_INVOICE', 'COMPLETED'].includes(spec.status)) {
        await prisma.workLog.create({
          data: {
            jobId: job.id,
            contractorId: engineer.id,
            loggedById: loggedBy.id,
            hoursWorked: 2.5,
            rateApplied: engineer.hourlyRate ?? 45,
            workDate: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000),
            notes: 'Initial visit — work carried out as quoted.',
          },
        });
      }

      createdJobs++;
    }

    console.log(`Created ${createdJobs} jobs.`);
  }

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
