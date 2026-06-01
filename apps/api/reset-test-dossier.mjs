import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Reset all assigned dossiers that were validated directly (nkAbgegeben: false, nkVisiert: true)
const result = await prisma.notenuebersicht.updateMany({
  where: { nkVisiert: true, pexUserId: { not: null } },
  data: { nkVisiert: false, nkChange: false },
});

console.log(`Reset ${result.count} dossier(s) → nkVisiert: false`);
await prisma.$disconnect();
