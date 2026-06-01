import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const items = await (prisma.notenuebersicht).findMany({
  where: { pexUserId: { not: null } },
  select: { kandidatId: true, nkVisiert: true, nkAbgegeben: true, pexUserId: true },
  take: 20,
});
console.log(JSON.stringify(items, null, 2));
await prisma.$disconnect();
