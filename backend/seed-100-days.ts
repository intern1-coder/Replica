import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Starting massive seed process...");

  // 1. Clear old work logs
  console.log("Clearing old work logs...");
  await prisma.workLog.deleteMany({});
  
  // 2. Ensure PM user
  let pm = await prisma.user.findFirst({ where: { role: 'PM' } });
  if (!pm) {
    pm = await prisma.user.create({
      data: { email: 'pm@affinity.com', passwordHash: 'password', name: 'Project Manager', role: 'PM' }
    });
  }

  // 3. Ensure multiple contractors
  console.log("Ensuring contractors exist...");
  let contractors = await prisma.user.findMany({ where: { role: 'CONTRACTOR' } });
  while (contractors.length < 5) {
    const newContractor = await prisma.user.create({
      data: { 
        email: `contractor${contractors.length + 1}@affinity.com`, 
        passwordHash: 'password', 
        name: `Contractor ${contractors.length + 1}`, 
        role: 'CONTRACTOR' 
      }
    });
    contractors.push(newContractor);
  }

  // 4. Ensure Clients & Properties for Jobs
  console.log("Ensuring jobs exist...");
  let clients = await prisma.client.findMany();
  if (clients.length === 0) {
    for(let i=1; i<=3; i++) {
      clients.push(await prisma.client.create({ data: { name: `Client ${i}`, email: `client${i}@test.com` } }));
    }
  }

  let properties = await prisma.property.findMany();
  if (properties.length === 0) {
    for(let i=1; i<=5; i++) {
      properties.push(await prisma.property.create({ data: { address: `${i}00 Main St, Suite ${i}`, accessNotes: `Key under mat ${i}` } }));
    }
  }

  let jobs = await prisma.job.findMany();
  const statuses = ['QUOTED', 'AUTHORISED', 'TO_BE_CHECKED', 'CHECKED', 'COMPLETED'];
  while (jobs.length < 15) {
    const job = await prisma.job.create({
      data: {
        clientId: clients[Math.floor(Math.random() * clients.length)].id,
        propertyId: properties[Math.floor(Math.random() * properties.length)].id,
        description: `Complex repair work for property ${jobs.length + 1}`,
        status: statuses[Math.floor(Math.random() * statuses.length)],
      }
    });
    jobs.push(job);
  }

  // 5. Generate 100 days of data
  console.log("Generating 100 days of combinations...");
  const logsToCreate = [];
  
  const today = new Date();
  
  for (let i = 0; i < 100; i++) {
    const currentDate = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    currentDate.setUTCHours(12, 0, 0, 0); // Noon UTC

    // Scenario 1: 3 contractors on the same job (Team effort)
    // Happens every 5 days
    if (i % 5 === 0) {
      const targetJob = jobs[Math.floor(Math.random() * jobs.length)];
      for (let c = 0; c < 3; c++) {
        logsToCreate.push({
          jobId: targetJob.id,
          contractorId: contractors[c].id,
          loggedById: pm.id,
          workDate: currentDate,
          hoursWorked: 4.5,
          rateApplied: 45.00,
          materialCost: Math.random() > 0.5 ? 120.00 : 0,
          notes: `Team effort on massive repair task. ${contractors[c].name} handled section ${c+1}.`
        });
      }
    }

    // Scenario 2: 1 contractor visiting 3 different jobs in one day (Route hopping)
    // Happens every 3 days
    if (i % 3 === 0) {
      const busyContractor = contractors[4]; // Contractor 5
      const visitedJobs = [];
      while(visitedJobs.length < 3) {
        const j = jobs[Math.floor(Math.random() * jobs.length)];
        if (!visitedJobs.includes(j)) visitedJobs.push(j);
      }
      for (let j = 0; j < 3; j++) {
        logsToCreate.push({
          jobId: visitedJobs[j].id,
          contractorId: busyContractor.id,
          loggedById: pm.id,
          workDate: currentDate,
          hoursWorked: 2.5,
          rateApplied: 55.00,
          materialCost: 0,
          notes: `Routine maintenance route. Job ${j+1} of the day. Everything looked good at ${visitedJobs[j].description}.`
        });
      }
    }

    // Scenario 3: Standard 1 contractor, 1 job for the day
    // Happens every day
    const standardJob = jobs[Math.floor(Math.random() * jobs.length)];
    const standardContractor = contractors[3];
    logsToCreate.push({
      jobId: standardJob.id,
      contractorId: standardContractor.id,
      loggedById: pm.id,
      workDate: currentDate,
      hoursWorked: 8.0,
      rateApplied: 50.00,
      materialCost: 45.50,
      notes: `Full day focused on this single property. Fixed all reported issues.`
    });
  }

  console.log(`Inserting ${logsToCreate.length} work logs...`);
  await prisma.workLog.createMany({
    data: logsToCreate
  });

  console.log("Seeding complete! Successfully generated 100 days of complex combinations.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
