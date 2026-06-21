import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const pm = await prisma.user.findFirst({ where: { role: 'PM' } });
  const contractor = await prisma.user.findFirst({ where: { role: 'CONTRACTOR' } });
  const job = await prisma.job.findFirst();

  if (!pm || !contractor || !job) {
    console.error('Missing PM, Contractor, or Job in DB');
    return;
  }

  const today = new Date();
  const dates = [
    new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000),
    new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000),
    today
  ];

  for (let i = 0; i < dates.length; i++) {
    const workDate = dates[i];
    await prisma.workLog.create({
      data: {
        jobId: job.id,
        contractorId: contractor.id,
        loggedById: pm.id,
        hoursWorked: Math.floor(Math.random() * 4) + 2,
        rateApplied: contractor.hourlyRate || 50,
        workDate: workDate,
        notes: `Test work log for day ${i + 1}`
      }
    });
    console.log(`Created work log for ${workDate.toLocaleDateString()}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
