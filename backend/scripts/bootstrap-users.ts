/**
 * Idempotent bootstrap for SUPER_ADMIN (developer) and client ADMIN accounts.
 *
 * Usage (local or production — reads from .env or shell env):
 *   Set SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, CLIENT_ADMIN_EMAIL, CLIENT_ADMIN_PASSWORD
 *   in backend/.env, then: npm run bootstrap:users
 *
 * Example production:
 *   docker compose exec app npx tsx scripts/bootstrap-users.ts
 */
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const MIN_PASSWORD_LENGTH = 8;

interface BootstrapUser {
  email: string;
  password: string;
  name: string;
  role: Role;
  label: string;
}

function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function requireEnv(key: string): string {
  const value = readEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function validatePassword(password: string, label: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${label} password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

async function upsertUser(spec: BootstrapUser): Promise<void> {
  validatePassword(spec.password, spec.label);
  const passwordHash = await bcrypt.hash(spec.password, 10);

  const user = await prisma.user.upsert({
    where: { email: spec.email },
    update: {
      name: spec.name,
      role: spec.role,
      passwordHash,
      deletedAt: null,
    },
    create: {
      email: spec.email,
      name: spec.name,
      role: spec.role,
      hourlyRate: 0,
      passwordHash,
    },
    select: { id: true, email: true, role: true },
  });

  console.log(`✓ ${spec.label}: ${user.email} (${user.role})`);
}

async function main(): Promise<void> {
  const superAdminEmail = requireEnv('SUPER_ADMIN_EMAIL');
  const superAdminPassword = requireEnv('SUPER_ADMIN_PASSWORD');
  const clientAdminEmail = requireEnv('CLIENT_ADMIN_EMAIL');
  const clientAdminPassword = requireEnv('CLIENT_ADMIN_PASSWORD');

  const superAdminName = readEnv('SUPER_ADMIN_NAME') ?? 'Super Admin';
  const clientAdminName = readEnv('CLIENT_ADMIN_NAME') ?? 'Client Admin';

  console.log('Bootstrapping admin accounts...');

  await upsertUser({
    email: superAdminEmail,
    password: superAdminPassword,
    name: superAdminName,
    role: Role.SUPER_ADMIN,
    label: 'Super Admin',
  });

  await upsertUser({
    email: clientAdminEmail,
    password: clientAdminPassword,
    name: clientAdminName,
    role: Role.ADMIN,
    label: 'Client Admin',
  });

  console.log('Bootstrap complete.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
