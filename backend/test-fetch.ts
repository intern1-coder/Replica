import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'admin@affinity.local' } });
  if (!user) throw new Error('No user found');
  
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'change-me-to-a-long-random-secret-at-least-64-chars',
    { expiresIn: '1h' }
  );

  const res = await fetch('http://localhost:3000/api/work-logs', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
}

main().catch(console.error);
