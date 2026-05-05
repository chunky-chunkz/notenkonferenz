import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const r = await prisma.user.updateMany({ where: { role: 'USER' }, data: { role: 'ADMIN' } });
console.log(`Updated ${r.count} user(s) to ADMIN`);

const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
console.table(users);

await prisma.$disconnect();
