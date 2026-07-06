/**
 * Deletes all operational/test data while preserving User and Setting rows.
 *
 * Usage (local):
 *   npm run reset:test-data
 *
 * Usage (production):
 *   docker compose exec app npx tsx scripts/reset-test-data.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userCountBefore = await prisma.user.count({ where: { deletedAt: null } });
  const settingCountBefore = await prisma.setting.count();

  console.log(`Preserving ${userCountBefore} user(s) and ${settingCountBefore} setting(s)...`);

  await prisma.$transaction(async (tx) => {
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
  });

  const userCountAfter = await prisma.user.count({ where: { deletedAt: null } });
  const settingCountAfter = await prisma.setting.count();

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
