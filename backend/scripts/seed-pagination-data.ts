import { JobStatus, PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { normalizeAddress } from '../src/lib/utils';

const prisma = new PrismaClient();
const DEMO_PREFIX = 'Pagination Demo';
const RECORD_COUNT = 50;

async function main() {
  console.log(`Seeding ${RECORD_COUNT} records for each pagination view...`);

  const passwordHash = await bcrypt.hash('DemoUser@123', 10);
  const clients = [];
  const properties = [];
  const engineers = [];

  for (let index = 1; index <= RECORD_COUNT; index += 1) {
    const client = await prisma.client.upsert({
      where: { id: `pagination-demo-client-${index}` },
      update: {},
      create: {
        id: `pagination-demo-client-${index}`,
        name: `${DEMO_PREFIX} Client ${String(index).padStart(2, '0')}`,
        email: `pagination-client-${index}@example.local`,
        phone: `020 7000 ${String(index).padStart(4, '0')}`,
      },
    });
    clients.push(client);

    const address = `${index} Pagination Demo Road, London`;
    const property = await prisma.property.upsert({
      where: { id: `pagination-demo-property-${index}` },
      update: { currentClientId: client.id },
      create: {
        id: `pagination-demo-property-${index}`,
        address,
        postcode: `PD${String(index).padStart(2, '0')} ${index % 10}AB`,
        normalizedAddress: normalizeAddress(address),
        currentClientId: client.id,
      },
    });
    properties.push(property);

    const engineer = await prisma.engineer.upsert({
      where: { id: `pagination-demo-engineer-${index}` },
      update: {},
      create: {
        id: `pagination-demo-engineer-${index}`,
        name: `${DEMO_PREFIX} Engineer ${String(index).padStart(2, '0')}`,
        email: `pagination-engineer-${index}@example.local`,
        phone: `07700 8${String(index).padStart(4, '0')}`,
        hourlyRate: 35 + (index % 16),
      },
    });
    engineers.push(engineer);

    await prisma.user.upsert({
      where: { email: `pagination-user-${index}@example.local` },
      update: {},
      create: {
        email: `pagination-user-${index}@example.local`,
        name: `${DEMO_PREFIX} User ${String(index).padStart(2, '0')}`,
        role: Role.CONTRACTOR,
        passwordHash,
      },
    });
  }

  const jobStatuses: JobStatus[] = [
    JobStatus.TO_BE_CHECKED,
    JobStatus.CHECKED,
    JobStatus.QUOTED,
    JobStatus.AUTHORISED,
    JobStatus.PENDING_INVOICE,
  ];

  for (let index = 1; index <= RECORD_COUNT; index += 1) {
    const description = `${DEMO_PREFIX} Job ${String(index).padStart(2, '0')}`;
    const existing = await prisma.job.findFirst({ where: { description } });

    if (existing) continue;

    await prisma.job.create({
      data: {
        clientId: clients[index - 1].id,
        propertyId: properties[index - 1].id,
        description,
        status: jobStatuses[(index - 1) % jobStatuses.length],
        quotedValue: 100 + index * 10,
        assignedContractors: {
          connect: [{ id: engineers[index - 1].id }],
        },
      },
    });
  }

  console.log(`Created or verified ${RECORD_COUNT} pagination demo clients.`);
  console.log(`Created or verified ${RECORD_COUNT} pagination demo properties.`);
  console.log(`Created or verified ${RECORD_COUNT} pagination demo engineers.`);
  console.log(`Created or verified ${RECORD_COUNT} pagination demo users.`);
  console.log(`Created or verified ${RECORD_COUNT} pagination demo jobs.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });