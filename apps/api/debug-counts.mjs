import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const total = await prisma.notenuebersicht.count();
const notValidated = await prisma.notenuebersicht.count({ where: { nkVisiert: false } });
const noNote = await prisma.notenuebersicht.count({ where: { notePaErrechnet: null } });
const samples = await prisma.notenuebersicht.findMany({
  select: { nkVisiert: true, notePaErrechnet: true, fachrichtung: true },
  take: 5
});
console.log(JSON.stringify({ total, notValidated, noNote, samples }, null, 2));
await prisma.$disconnect();
