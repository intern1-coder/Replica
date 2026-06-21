import { PrismaClient, JobStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Starting proper realistic seed process...");

  // 1. Clear old jobs and related data
  console.log("Clearing old jobs and related data...");
  await prisma.workLog.deleteMany({});
  await prisma.communicationLog.deleteMany({});
  await prisma.jobQuoteLineItem.deleteMany({});
  await prisma.jobMedia.deleteMany({});
  await prisma.generatedDocument.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.job.deleteMany({});

  // 2. Ensure we have contractors, PM, properties, and clients
  console.log("Loading base entities...");
  let contractors = await prisma.user.findMany({ where: { role: 'CONTRACTOR' } });
  let pm = await prisma.user.findFirst({ where: { role: 'PM' } });
  
  if (contractors.length === 0 || !pm) {
    console.error("Missing contractors or PM in database. Please run your original init seed first.");
    return;
  }

  const properties = await prisma.property.findMany();
  const clients = await prisma.client.findMany();

  if (properties.length === 0 || clients.length === 0) {
    console.error("Missing properties or clients.");
    return;
  }

  // 3. Generate Jobs from Jan 1, 2026 to June 20, 2026
  console.log("Generating Jobs from Jan 1, 2026...");
  
  const startDate = new Date('2026-01-01T08:00:00Z');
  const endDate = new Date('2026-06-20T17:00:00Z');
  
  const oneDayMs = 24 * 60 * 60 * 1000;
  let currentDateMs = startDate.getTime();

  let jobsCreated = 0;
  let workLogsCreated = 0;

  const jobDescriptions = [
    "Fix leaking pipe in bathroom",
    "Replace broken window glass",
    "Routine AC maintenance",
    "Repair damaged drywall",
    "Electrical outlet not working",
    "Install new light fixtures",
    "Fix jammed front door",
    "Emergency roof leak repair",
    "Unblock main drain",
    "Paint exterior wall",
    "Fix heating system boiler",
    "Replace faulty smoke alarms"
  ];

  while (currentDateMs <= endDate.getTime()) {
    const currentDay = new Date(currentDateMs);
    
    // Skip weekends sometimes
    const isWeekend = currentDay.getDay() === 0 || currentDay.getDay() === 6;
    let numJobsToCreate = isWeekend ? Math.floor(Math.random() * 2) : Math.floor(Math.random() * 4) + 1; // 0-1 on weekends, 1-4 on weekdays
    
    for (let i = 0; i < numJobsToCreate; i++) {
      const property = properties[Math.floor(Math.random() * properties.length)];
      const client = clients[Math.floor(Math.random() * clients.length)];
      const assignedContractor = contractors[Math.floor(Math.random() * contractors.length)];
      
      const description = jobDescriptions[Math.floor(Math.random() * jobDescriptions.length)];
      
      // Determine status based on how old the job is
      const daysAgo = Math.floor((endDate.getTime() - currentDateMs) / oneDayMs);
      let status: JobStatus = 'COMPLETED';
      if (daysAgo < 2) status = 'TO_BE_CHECKED';
      else if (daysAgo < 5) status = 'CHECKED';
      else if (daysAgo < 10) status = 'QUOTED';
      else if (daysAgo < 15) status = 'AUTHORISED';

      // Create Job
      const job = await prisma.job.create({
        data: {
          propertyId: property.id,
          clientId: client.id,
          description: description,
          status: status,
          quotedValue: (Math.floor(Math.random() * 50) + 10) * 10,
          createdAt: new Date(currentDateMs + Math.random() * 8 * 60 * 60 * 1000), // Random time during the day
          assignedContractors: { connect: [{ id: assignedContractor.id }] }
        }
      });
      jobsCreated++;

      // Create 1 or 2 Work Logs for this specific job, clustered around the creation date
      const numLogs = Math.random() > 0.8 ? 2 : 1; // 80% chance of 1 log, 20% chance of 2 logs
      for (let j = 0; j < numLogs; j++) {
        // Work is done 0 to 2 days after job creation
        const workDate = new Date(job.createdAt.getTime() + (Math.floor(Math.random() * 3) * oneDayMs));
        const hours = (Math.floor(Math.random() * 8) + 1) + (Math.random() > 0.5 ? 0.5 : 0); // 1.0 to 8.5 hours
        const rate = Number(assignedContractor.hourlyRate) || 50.00;

        await prisma.workLog.create({
          data: {
            jobId: job.id,
            contractorId: assignedContractor.id,
            loggedById: pm.id,
            hoursWorked: hours,
            rateApplied: rate,
            workDate: workDate,
            notes: j === 0 ? "Initial fix and inspection completed." : "Follow-up visit to finalize repairs."
          }
        });
        workLogsCreated++;
      }
    }

    currentDateMs += oneDayMs;
  }

  console.log(`Seeding complete! Successfully generated ${jobsCreated} realistic jobs and ${workLogsCreated} work logs from Jan 1, 2026.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
