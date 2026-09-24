const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find all contractors
  const contractors = await prisma.user.findMany({ where: { role: 'CONTRACTOR' } });
  console.log('Found', contractors.length, 'contractors');
  contractors.forEach(c => {
    console.log(' -', c.id, '|', c.email, '|', c.name);
  });
  
  // Check if any user exists at all
  const allUsers = await prisma.user.findMany({});
  console.log('\nAll users count:', allUsers.length);
  allUsers.forEach(u => {
    console.log(' -', u.id, '|', u.email, '| role:', u.role);
  });
  
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });