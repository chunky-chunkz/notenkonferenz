import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Show current state
const kCount = await prisma.kandidat.count();
const nuCount = await prisma.notenuebersicht.count();
const hexCount = await prisma.hauptexperte.count();
const nexCount = await prisma.nebenexperte.count();
const vfCount = await prisma.vf.count();
const nuWithNotes = await prisma.notenuebersicht.count({ where: { notePaErrechnet: { not: null } } });
const nuWithHex = await prisma.notenuebersicht.count({ where: { hauptexperteId: { not: null } } });
const nuWithFach = await prisma.notenuebersicht.count({ where: { fachrichtung: { not: null } } });

console.log(`Kandidaten: ${kCount} | Notenuebersichten: ${nuCount}`);
console.log(`Hauptexperten: ${hexCount} | Nebenexperten: ${nexCount} | VFs: ${vfCount}`);
console.log(`NU with notes: ${nuWithNotes} | with HEX: ${nuWithHex} | with fachrichtung: ${nuWithFach}`);

await prisma.$disconnect();
