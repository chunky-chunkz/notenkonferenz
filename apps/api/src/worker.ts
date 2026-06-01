/**
 * BullMQ Worker – processes import/download jobs off the queue.
 *
 * Run separately: `npm run worker` (or `tsx src/worker.ts`)
 */
import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { redis } from './config/redis.js';
import { logger } from './config/logger.js';
import { prisma } from './config/database.js';
import {
  pkorgSwitchRole,
  pkorgDownloadExcel,
  pkorgGetMandantId,
  pkorgDownloadPortfolioZip,
} from './services/pkorg/pkorgClient.js';
import { logAction } from './services/logService.js';
import * as XLSX from 'xlsx';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './config/env.js';

type CookieJar = Record<string, string>;

interface JobData {
  cookies: CookieJar;
  roleUrl?: string;
  userId?: number;
  fachrichtung?: string;
  logs?: string[];
}

function addLog(job: Job, message: string) {
  const data = job.data as JobData;
  if (!data.logs) data.logs = [];
  data.logs.push(message);
  job.updateData(data);
  logger.info(`[Job ${job.id}] ${message}`);
}

if (!redis) {
  logger.error('Worker requires REDIS_URL — exiting.');
  process.exit(1);
}

const worker = new Worker(
  'imports',
  async (job: Job) => {
    const data = job.data as JobData;
    data.logs = [];

    logger.info(`Processing job: ${job.name} (id=${job.id})`);

    switch (job.name) {
      case 'import_notenuebersicht':
        await handleImportNotenuebersicht(job, data);
        break;
      case 'import_durchfuehrung':
        await handleImportDurchfuehrung(job, data);
        break;
      case 'download_portfolios':
        await handleDownloadPortfolios(job, data);
        break;
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: redis,
    concurrency: 1,
  },
);

worker.on('completed', (job) => {
  logger.info(`✅ Job completed: ${job.name} (id=${job.id})`);
});

worker.on('failed', (job, err) => {
  logger.error(`❌ Job failed: ${job?.name} (id=${job?.id}): ${err.message}`);
});

// Crash on unrecoverable Redis errors so the process restarts cleanly
worker.on('error', (err) => {
  logger.error(`Worker error: ${err.message}`);
  // Do NOT process.exit here — BullMQ/ioredis will auto-reconnect on transient errors
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
});

// ─── Job Handlers ────────────────────────────────────────────────────────────

async function handleImportNotenuebersicht(job: Job, data: JobData) {
  addLog(job, '⏳ Starting Notenübersicht import...');
  await job.updateProgress(5);

  // Switch role if needed — returns updated cookies with the new session
  let cookies = data.cookies;
  if (data.roleUrl && data.roleUrl !== '#') {
    addLog(job, `🔗 Switching role: ${data.roleUrl}`);
    const switchResult = await pkorgSwitchRole(cookies, data.roleUrl);
    cookies = switchResult.cookies;
    addLog(job, '✅ Role switched');
  }

  // Download Excel
  addLog(job, '⬇️ Downloading Excel...');
  const excelUrl = `${env.PKORG_BASE_URL}/verwaltung/301/41?nauswertungid=847`;
  const excelBuffer = await pkorgDownloadExcel(cookies, excelUrl);
  await job.updateProgress(20);

  // Parse Excel
  addLog(job, '📊 Parsing Excel...');
  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet);
  await job.updateProgress(30);

  addLog(job, `📋 Found ${rows.length} rows`);
  if (rows.length > 0) {
    addLog(job, `🔑 Keys: ${Object.keys(rows[0]).join(' | ')}`);
    addLog(job, `🔍 Row0: ${JSON.stringify(rows[0])}`);
  }

  // Collect entities
  const existingKandidaten = new Set((await prisma.kandidat.findMany({ select: { id: true } })).map((k) => k.id));
  const existingHex = new Set((await prisma.hauptexperte.findMany({ select: { id: true } })).map((h) => h.id));
  const existingNex = new Set((await prisma.nebenexperte.findMany({ select: { id: true } })).map((n) => n.id));
  const existingVfs = new Set((await prisma.vf.findMany({ select: { id: true } })).map((v) => v.id));

  const newKandidaten: any[] = [];
  const newHex: any[] = [];
  const newNex: any[] = [];
  const newVfs: any[] = [];

  for (const row of rows) {
    // Real PKOrg column names (verified from actual Excel download)
    const kId = parseInt(row['Kandidat:in ID']);
    if (kId && !existingKandidaten.has(kId)) {
      newKandidaten.push({ id: kId, vorname: row['Vorname KAND'] ?? '', nachname: row['Nachname KAND'] ?? '' });
      existingKandidaten.add(kId);
    }

    const hexId = parseInt(row['IdHEX']);
    if (hexId && !existingHex.has(hexId)) {
      newHex.push({ id: hexId, vorname: row['VornameHEX'] ?? '', nachname: row['NachnameHEX'] ?? '' });
      existingHex.add(hexId);
    }

    const nexId = parseInt(row['IdNEX']);
    if (nexId && !existingNex.has(nexId)) {
      newNex.push({ id: nexId, vorname: row['VornameNEX'] ?? '', nachname: row['NachnameNEX'] ?? '' });
      existingNex.add(nexId);
    }

    const vfId = parseInt(row['IdVF']);
    if (vfId && !existingVfs.has(vfId)) {
      newVfs.push({ id: vfId, vorname: row['Vorname VF'] ?? '', nachname: row['Nachname VF'] ?? '' });
      existingVfs.add(vfId);
    }
  }

  // Bulk create base entities
  addLog(job, `🔢 To create: ${newKandidaten.length} Kand, ${newHex.length} HEX, ${newNex.length} NEX, ${newVfs.length} VF`);
  if (newHex.length > 0) addLog(job, `🔍 HEX[0]: ${JSON.stringify(newHex[0])}`);
  await prisma.$transaction([
    prisma.kandidat.createMany({ data: newKandidaten, skipDuplicates: true }),
    prisma.hauptexperte.createMany({ data: newHex, skipDuplicates: true }),
    prisma.nebenexperte.createMany({ data: newNex, skipDuplicates: true }),
    prisma.vf.createMany({ data: newVfs, skipDuplicates: true }),
  ]);

  addLog(job, `✅ Created: ${newKandidaten.length} Kandidaten, ${newHex.length} HEX, ${newNex.length} NEX, ${newVfs.length} VF`);
  await job.updateProgress(50);

  // Upsert Notenuebersichten
  addLog(job, '📝 Upserting Notenuebersichten...');
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const kandidatId = parseInt(row['Kandidat:in ID']);
    if (!kandidatId) continue;

    const noteData = {
      fachrichtung:         row['Fachrichtung']         ?? undefined,  // don't overwrite with null
      hauptexperteId:       parseInt(row['IdHEX'])      || undefined,
      nebenexperteId:       parseInt(row['IdNEX'])      || undefined,
      vfId:                 parseInt(row['IdVF'])        || undefined,
      punkteTeil1Vf:        parseInt(row['PunkteTeil1Vf'])     || undefined,
      punkteTeil2Vf:        parseInt(row['PunkteTeil2Vf'])     || undefined,
      noteTeil1Vf:          parseFloat(row['NoteTeil1Vf'])     || undefined,
      noteTeil2Vf:          parseFloat(row['NoteTeil2Vf'])     || undefined,
      punkteTeil1:          parseInt(row['PunkteTeil1'])       || undefined,
      punkteTeil2:          parseInt(row['PunkteTeil2'])       || undefined,
      punkteTeil3:          parseInt(row['PunkteTeil3'])       || undefined,
      noteTeil1:            parseFloat(row['NoteTeil1'])       || undefined,
      noteTeil2:            parseFloat(row['NoteTeil2'])       || undefined,
      noteTeil3:            parseFloat(row['NoteTeil3'])       || undefined,
      notePa:               parseFloat(row['Note PA'])         || undefined,
      noteTeil1Errechnet:   parseFloat(row['NoteTeil1Errechnet'])  || undefined,
      noteTeil2Errechnet:   parseFloat(row['NoteTeil2Errechnet'])  || undefined,
      noteTeil3Errechnet:   parseFloat(row['NoteTeil3Errechnet'])  || undefined,
      notePaErrechnet:      parseFloat(row['NotePAErrechnet'])     || undefined,
    };

    // Strip undefined keys so Prisma ignores missing columns on updates
    const noteDataClean = Object.fromEntries(
      Object.entries(noteData).filter(([, v]) => v !== undefined)
    );

    const existing = await prisma.notenuebersicht.findUnique({ where: { kandidatId } });
    if (existing) {
      await prisma.notenuebersicht.update({ where: { kandidatId }, data: noteDataClean });
      updated++;
    } else {
      await prisma.notenuebersicht.create({ data: { kandidatId, ...noteDataClean } });
      created++;
    }

    if (i % 50 === 0) {
      await job.updateProgress(50 + Math.round((i / rows.length) * 45));
    }
  }

  addLog(job, `✅ Notenuebersichten: ${created} created, ${updated} updated`);
  await logAction(data.userId, 'Notenübersicht imported via job');
  await job.updateProgress(100);
  addLog(job, '✅ Import complete');
}

async function handleImportDurchfuehrung(job: Job, data: JobData) {
  addLog(job, '⏳ Starting Durchführung import...');
  await job.updateProgress(5);

  let cookies = data.cookies;
  if (data.roleUrl && data.roleUrl !== '#') {
    const switchResult = await pkorgSwitchRole(cookies, data.roleUrl);
    cookies = switchResult.cookies;
    addLog(job, '✅ Role switched');
  }

  addLog(job, '⬇️ Downloading Durchführung Excel...');
  const excelUrl = `${env.PKORG_BASE_URL}/verwaltung/301/41?nauswertungid=839`;
  const excelBuffer = await pkorgDownloadExcel(cookies, excelUrl);
  await job.updateProgress(30);

  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet);

  addLog(job, `📋 Found ${rows.length} rows, updating Kandidaten & VFs...`);
  if (rows.length > 0) {
    addLog(job, `🔑 DF-Keys: ${Object.keys(rows[0]).join(' | ')}`);
    addLog(job, `🔍 DF-Row0: ${JSON.stringify(rows[0])}`);
  }

  let updatedK = 0;
  let updatedV = 0;

  for (const row of rows) {
    // Durchführungsübersicht (nauswertungid=839) uses different column names than Notenübersicht
    const kId = parseInt(row['KandidatID'] ?? row['Kandidat:in ID']);
    if (kId) {
      try {
        await prisma.kandidat.update({
          where: { id: kId },
          data: {
            mail:       row['MailKAN']    || row['E-Mail KAND'] || undefined,
            telefon:    row['Telefon']                          || undefined,
            geschlecht: row['GeschlechtKAN']                   || undefined,
            titel:      row['TitelKAN']                        || undefined,
            firma:      row['FirmaGeKAN'] || row['FirmaGe KAND'] || undefined,
            plz:        String(row['PlzGeKAN'] ?? row['Plz (G) KAND'] ?? '') || undefined,
            ort:        row['OrtGeKAN']  || row['OrtGe KAND']  || undefined,
          },
        });
        updatedK++;
      } catch { /* Kandidat may not exist yet */ }
    }

    const vfId = parseInt(row['NpersidVF']);
    if (vfId) {
      try {
        await prisma.vf.upsert({
          where: { id: vfId },
          create: {
            id: vfId,
            vorname: row['VornameVF'] ?? row['Vorname VF'] ?? '',
            nachname: row['NachnameVF'] ?? row['Nachname VF'] ?? '',
            mail:       row['MailVF']   || row['E-Mail VF'] || undefined,
            telefon:    row['Telefon']                       || undefined,
            geschlecht: row['GeschlechtVF']                  || undefined,
            titel:      row['TitelVF']                       || undefined,
            firma:      row['FirmaVF']                       || undefined,
            plz:        String(row['PlzVF'] ?? '') || undefined,
            ort:        row['OrtVF']               || undefined,
          },
          update: {
            mail:       row['MailVF']   || row['E-Mail VF'] || undefined,
            telefon:    row['Telefon']                       || undefined,
            geschlecht: row['GeschlechtVF']                  || undefined,
            titel:      row['TitelVF']                       || undefined,
            firma:      row['FirmaVF']                       || undefined,
            plz:        String(row['PlzVF'] ?? '') || undefined,
            ort:        row['OrtVF']               || undefined,
          },
        });
        updatedV++;
      } catch (e) {
        addLog(job, `⚠️ VF ${vfId}: ${(e as Error).message}`);
      }
    }
  }

  addLog(job, `✅ Updated: ${updatedK} Kandidaten, ${updatedV} VFs`);
  await logAction(data.userId, 'Durchführung imported via job');
  await job.updateProgress(100);
}

async function handleDownloadPortfolios(job: Job, data: JobData) {
  addLog(job, '⏳ Starting portfolio download...');
  await job.updateProgress(0);

  if (data.roleUrl && data.roleUrl !== '#') {
    const switchResult = await pkorgSwitchRole(data.cookies, data.roleUrl);
    data.cookies = switchResult.cookies;
    addLog(job, '✅ Role switched');
  }

  // Get mandant ID
  const nmandantid = await pkorgGetMandantId(data.cookies);
  addLog(job, `📋 Mandant ID: ${nmandantid}`);

  const portfoliosDir = data.fachrichtung
    ? path.join(env.MEDIA_DIR, 'portfolios', data.fachrichtung)
    : path.join(env.MEDIA_DIR, 'portfolios');
  fs.mkdirSync(portfoliosDir, { recursive: true });

  const kandidaten = await prisma.kandidat.findMany();
  const total = kandidaten.length;
  addLog(job, `📦 ${total} Kandidaten to process`);

  for (let i = 0; i < kandidaten.length; i++) {
    const kandidat = kandidaten[i];
    const filePath = path.join(portfoliosDir, `${kandidat.id}.zip`);

    if (fs.existsSync(filePath)) {
      addLog(job, `⏩ ${kandidat.id}: already exists`);
    } else {
      try {
        addLog(job, `⬇️ ${kandidat.id}: downloading...`);
        const buffer = await pkorgDownloadPortfolioZip(data.cookies, nmandantid, kandidat.id);
        fs.writeFileSync(filePath, buffer);
        addLog(job, `✅ ${kandidat.id}: saved`);
      } catch (err) {
        addLog(job, `⚠️ ${kandidat.id}: ${(err as Error).message}`);
      }

      // Rate limiting - wait 2s between downloads
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    await job.updateProgress(Math.round(((i + 1) / total) * 100));
  }

  await logAction(data.userId, 'Portfolio download completed via job');
  addLog(job, '✅ All downloads complete');
}

logger.info('🔧 Worker started, waiting for jobs...');
