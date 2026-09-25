const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.workLog.deleteMany({}).then(() => {
  console.log('Deleted all work logs');
}).finally(() => prisma.$disconnect());