const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.user.findFirst({ where: { role: 'PM' } }).then(user => {
  console.log('PM user:', user ? user.email : 'not found');
  return prisma.job.count();
}).then(count => {
  console.log('Job count:', count);
}).finally(() => prisma.$disconnect());