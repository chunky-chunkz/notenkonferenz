import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Show all users
console.log('\n=== USERS ===');
const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
console.table(users);

// Show notenuebersicht with pexUserId info
console.log('\n=== NOTENUEBERSICHT (pexUserId summary) ===');
const total = await prisma.notenuebersicht.count();
const withPex = await prisma.notenuebersicht.count({ where: { pexUserId: { not: null } } });
const withoutPex = await prisma.notenuebersicht.count({ where: { pexUserId: null } });
console.log(`Total: ${total}, With pexUserId: ${withPex}, Without (NULL): ${withoutPex}`);

// Show entries that have a pexUserId set
if (withPex > 0) {
  console.log('\n=== ASSIGNED ITEMS (pexUserId set) ===');
  const assigned = await prisma.notenuebersicht.findMany({
    where: { pexUserId: { not: null } },
    select: {
      id: true,
      kandidatId: true,
      pexUserId: true,
      nkVisiert: true,
      pexUser: { select: { email: true } },
      kandidat: { select: { vorname: true, nachname: true } },
    },
    take: 10,
  });
  console.table(assigned.map(i => ({
    id: i.id,
    kandidatId: i.kandidatId,
    kandidat: `${i.kandidat?.vorname} ${i.kandidat?.nachname}`,
    pexUserId: i.pexUserId,
    pexEmail: i.pexUser?.email ?? '—',
    nkVisiert: i.nkVisiert,
  })));
}

// Check session user's items
for (const user of users) {
  const count = await prisma.notenuebersicht.count({ where: { pexUserId: user.id } });
  if (count > 0) console.log(`User ${user.email} (id=${user.id}) has ${count} item(s) assigned`);
}

await prisma.$disconnect();
