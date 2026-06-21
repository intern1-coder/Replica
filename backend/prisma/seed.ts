import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const defaultPassword = await bcrypt.hash('Password123!', 10);

  // 1. Create Users
  const admin = await prisma.user.upsert({
    where: { email: 'admin@affinity.local' },
    update: { passwordHash: defaultPassword },
    create: {
      email: 'admin@affinity.local',
      name: 'Admin User',
      role: Role.ADMIN,
      hourlyRate: 50.00,
      passwordHash: defaultPassword,
    },
  });

  const pm = await prisma.user.upsert({
    where: { email: 'pm@affinity.local' },
    update: { passwordHash: defaultPassword },
    create: {
      email: 'pm@affinity.local',
      name: 'Project Manager',
      role: Role.PM,
      hourlyRate: 40.00,
      passwordHash: defaultPassword,
    },
  });

  // 2. Create a Client
  const client = await prisma.client.create({
    data: {
      name: 'Acme Property Management',
      email: 'contact@acmeproperties.local',
      phone: '555-0100',
    },
  });

  // 3. Create a Property
  const property = await prisma.property.create({
    data: {
      address: '123 Main St, London, SW1A 1AA',
      normalizedAddress: '123 main st, london, sw1a 1aa',
    },
  });

  console.log('Seed successful! You can log in with:');
  console.log(`- ${admin.email}`);
  console.log(`- ${pm.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
