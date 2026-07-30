/**
 * Deletes ALL operational data (jobs, clients, properties, tenants,
 * engineers, work logs, media, receipts, generated documents, audit logs,
 * communication logs, reminders) while leaving User and Setting rows —
 * i.e. every login credential, role, and permission override — completely
 * untouched. This script never writes to the users table.
 *
 * Defaults to a DRY RUN: it prints exactly what would be deleted and exits
 * without changing anything. Nothing is deleted unless RESET_CONFIRM is set.
 *
 * Usage (dry run — safe, no changes):
 *   npm run reset:test-data
 *
 * Usage (actually delete, local):
 *   RESET_CONFIRM=DELETE_ALL_DATA npm run reset:test-data
 *
 * Usage (actually delete, production):
 *   docker compose exec -e RESET_CONFIRM=DELETE_ALL_DATA app npx tsx scripts/reset-test-data.ts
 */
import { PrismaClient } from '@prisma/client';
import { deleteMediaFromStorage } from '../src/services/storageService';

const prisma = new PrismaClient();
const CONFIRM_TOKEN = 'DELETE_ALL_DATA';

async function main() {
  const userCountBefore = await prisma.user.count({ where: { deletedAt: null } });
  const settingCountBefore = await prisma.setting.count();

  const [jobCount, clientCount, propertyCount, tenantCount, engineerCount, workLogCount, mediaCount, receiptCount, docCount] =
    await Promise.all([
      prisma.job.count(),
      prisma.client.count(),
      prisma.property.count(),
      prisma.tenant.count(),
      prisma.engineer.count(),
      prisma.workLog.count(),
      prisma.jobMedia.count(),
      prisma.workLogReceipt.count(),
      prisma.generatedDocument.count(),
    ]);

  console.log('Reset target — everything below would be PERMANENTLY deleted:');
  console.log(`  Jobs:                 ${jobCount}`);
  console.log(`  Clients:              ${clientCount}`);
  console.log(`  Properties:           ${propertyCount}`);
  console.log(`  Tenants:              ${tenantCount}`);
  console.log(`  Engineers:            ${engineerCount}`);
  console.log(`  Work logs:            ${workLogCount}`);
  console.log(`  Job media files:      ${mediaCount}`);
  console.log(`  Work log receipts:    ${receiptCount}`);
  console.log(`  Generated documents:  ${docCount}`);
  console.log('  (plus audit logs, communication logs, reminders, and quote line items belonging to those jobs)');
  console.log('');
  console.log(`Preserved untouched, no matter what: ${userCountBefore} user(s), ${settingCountBefore} setting(s).`);
  console.log('');

  if (process.env.RESET_CONFIRM !== CONFIRM_TOKEN) {
    console.log(`DRY RUN — nothing was deleted.`);
    console.log(`Re-run with RESET_CONFIRM=${CONFIRM_TOKEN} to actually delete the data listed above.`);
    return;
  }

  console.log('RESET_CONFIRM matched — deleting now...');

  // Collect storage keys BEFORE the DB transaction, so the DB cleanup below
  // doesn't depend on storage being reachable, and a storage failure never
  // leaves the database half-cleaned.
  const [mediaKeys, receiptKeys, docKeys] = await Promise.all([
    prisma.jobMedia.findMany({ select: { storageKey: true } }),
    prisma.workLogReceipt.findMany({ select: { storageKey: true } }),
    prisma.generatedDocument.findMany({ select: { storageKey: true } }),
  ]);
  const allStorageKeys = [...mediaKeys, ...receiptKeys, ...docKeys].map((r) => r.storageKey);

  await prisma.$transaction(
    async (tx) => {
      await tx.workLogReceipt.deleteMany({});
      await tx.workLog.deleteMany({});
      await tx.communicationLog.deleteMany({});
      await tx.jobQuoteLineItem.deleteMany({});
      await tx.jobMedia.deleteMany({});
      await tx.generatedDocument.deleteMany({});
      await tx.auditLog.deleteMany({});
      await tx.followUpReminder.deleteMany({});
      await tx.job.deleteMany({});
      await tx.propertyTenantHistory.deleteMany({});
      await tx.tenant.updateMany({
        data: { propertyId: null, lastPropertyId: null, lastClientId: null },
      });
      await tx.property.updateMany({ data: { parentId: null } });
      await tx.property.deleteMany({});
      await tx.tenant.deleteMany({});
      await tx.client.deleteMany({});
      await tx.engineer.deleteMany({});
      await tx.passwordResetToken.deleteMany({});
      // deleteMany does not reset SERIAL counters — without this the next job
      // created after a cleanup gets a stale number (e.g. JOB-0002 on an empty table).
      await tx.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('jobs', 'sequence'), 1, false)`
      );
    },
    // Default Prisma interactive-transaction timeout is 5s — comfortably
    // exceeded once tables hold real data. 17 deletes need real headroom.
    { timeout: 120_000 }
  );

  console.log(`Database rows deleted. Removing ${allStorageKeys.length} storage object(s)...`);
  let storageFailures = 0;
  for (const key of allStorageKeys) {
    try {
      await deleteMediaFromStorage(key);
    } catch (err) {
      storageFailures++;
      console.error(`  Failed to delete storage object ${key}:`, err instanceof Error ? err.message : err);
    }
  }
  if (storageFailures > 0) {
    console.warn(
      `${storageFailures} storage object(s) could not be deleted — see errors above. ` +
      `Their DB rows are already gone, so these are now orphaned files and must be cleaned up manually.`
    );
  } else if (allStorageKeys.length > 0) {
    console.log('All storage objects deleted.');
  }

  const userCountAfter = await prisma.user.count({ where: { deletedAt: null } });
  const settingCountAfter = await prisma.setting.count();

  console.log('');
  console.log('Reset complete.');
  console.log(`Users preserved: ${userCountAfter} (was ${userCountBefore})`);
  console.log(`Settings preserved: ${settingCountAfter} (was ${settingCountBefore})`);
}

main()
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
