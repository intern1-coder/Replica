const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.user.findMany({ where: { role: 'CONTRACTOR' } }).then(users => {
  console.log('Contractors:', JSON.stringify(users, null, 2));
  return prisma.user.count();
}).then(count => {
  console.log('Total users:', count);
}).finally(() => prisma.$disconnect());