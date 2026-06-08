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

// ─── pexUserId matching helpers ──────────────────────────────────────────────

type UserRow = { id: number; email: string };

/**
 * Candidate column names for the responsible-expert email field in PKOrg Excels.
 *
 * Order matters: detectEmailColumn() returns the first match, so PEX1 variants
 * (the confirmed Durchführung column names as of 2026) come first, followed by
 * generic PEX, then HEX1/HEX fallbacks.
 *
 * NpersidPEX1 / NpersidHEX are PKOrg person IDs, not emails — they are listed
 * here as a reminder but are NOT used for email matching.  If users ever store
 * their pkorg person ID (e.g. in a future pkorgPersonId field), matching against
 * NpersidPEX1 can be wired up then.
 */
const HEX_EMAIL_CANDIDATES = [
  // Durchführung export (confirmed 2026)
  'E-Mail PEX1', 'MailPEX1',
  // Notenübersicht / alternative DF export naming
  'E-Mail HEX1', 'MailHEX1',
  // Generic variants (older or alternate PKOrg exports)
  'E-Mail PEX', 'MailPEX', 'E-MailPEX',
  'E-Mail HEX', 'MailHEX', 'E-MailHEX', 'Mail HEX',
];

/**
 * Scan the first data row to find which email column actually exists.
 * Returns the matched column name, or null if none of the candidates are present.
 */
function detectEmailColumn(firstRow: any): string | null {
  return HEX_EMAIL_CANDIDATES.find((c) => firstRow[c] !== undefined) ?? null;
}

/** Extract the HEX/PEX email from a row using the detected column (or all candidates as fallback). */
function extractHexEmail(row: any, detectedCol: string | null): string {
  if (detectedCol) return (row[detectedCol] ?? '').toString().trim();
  // fallback: try all candidates in order
  for (const c of HEX_EMAIL_CANDIDATES) {
    const v = (row[c] ?? '').toString().trim();
    if (v) return v;
  }
  return '';
}

/**
 * Normalise a name fragment for fuzzy email matching:
 * lowercase, strip non-alphanumeric except German umlauts.
 */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

/**
 * Fallback: try to match an expert's vorname + nachname against users' email local parts.
 * Only accepts a match when exactly ONE user's email local part contains both the full
 * normalised lastname (≥3 chars) and the first ≥2 chars of the firstname — this avoids
 * false positives while still handling common patterns like "h.muster@bzz.ch".
 * Returns the matched user id or undefined.
 */
function matchByName(vorname: string, nachname: string, users: UserRow[]): number | undefined {
  const v = normName(vorname);
  const n = normName(nachname);
  if (n.length < 3 || v.length < 2) return undefined;

  const matches = users.filter((u) => {
    const local = normName(u.email.split('@')[0]);
    return local.includes(n) && local.includes(v.slice(0, 2));
  });
  return matches.length === 1 ? matches[0].id : undefined;
}

// ─── Role-switch + scope-verification helpers ────────────────────────────────

/**
 * Attempt PKOrg role switch. Returns updated cookies on success, original on
 * failure. Logs the outcome but does NOT throw — callers verify export scope
 * to decide whether it is safe to continue.
 */
async function attemptRoleSwitch(
  job: Job,
  cookies: CookieJar,
  roleUrl: string,
): Promise<{ cookies: CookieJar; switched: boolean }> {
  addLog(job, `🔗 Switching PKOrg role to: ${roleUrl}`);
  const result = await pkorgSwitchRole(cookies, roleUrl);
  if (result.switched) {
    addLog(job, '✅ PKOrg role switched');
    return { cookies: result.cookies, switched: true };
  }
  addLog(job, '⚠️ PKOrg role switch failed; verifying downloaded export scope before saving');
  return { cookies, switched: false };
}

/** Column names that carry the fachrichtung/beruf text in PKOrg Excel exports. */
const FACHRICHTUNG_COLUMNS = ['Fachrichtung', 'Beruf', 'Berufsfeld', 'FachrichtungText', 'BerufText'];

/**
 * Scan the first 20 rows for fachrichtung/beruf values and check whether
 * any of them contain the expected keyword (e.g. "Api" in "Inf Api CH neu").
 *
 * Returns:
 *   'match'       – at least one row contains the expected fachrichtung
 *   'mismatch'    – values found but none contain the expected fachrichtung
 *   'unverifiable' – no known fachrichtung/beruf column present in the export
 */
function checkExportScope(
  rows: any[],
  expectedFachrichtung: string,
): { result: 'match' | 'mismatch' | 'unverifiable'; samples: string[] } {
  const sample = rows.slice(0, 20);
  const values: string[] = [];

  for (const col of FACHRICHTUNG_COLUMNS) {
    if (rows[0]?.[col] === undefined) continue;
    for (const row of sample) {
      const v = (row[col] ?? '').toString().trim();
      if (v && !values.includes(v)) values.push(v);
    }
    if (values.length > 0) break;
  }

  if (values.length === 0) return { result: 'unverifiable', samples: [] };

  const norm = expectedFachrichtung.toLowerCase();
  const matched = values.some((v) => v.toLowerCase().includes(norm));
  return { result: matched ? 'match' : 'mismatch', samples: values.slice(0, 5) };
}

/**
 * Run scope verification after parsing rows; throw if the data does not match
 * or if the switch failed AND the scope cannot be confirmed.
 */
function assertExportScope(job: Job, rows: any[], data: JobData, switchSucceeded: boolean): void {
  if (!data.fachrichtung) return; // no constraint to verify

  const { result, samples } = checkExportScope(rows, data.fachrichtung);
  addLog(job, `🔍 Scope check: expected="${data.fachrichtung}", samples=${JSON.stringify(samples)}, result=${result}`);

  if (result === 'mismatch') {
    throw new Error(
      `Downloaded PKOrg export does not match expected fachrichtung "${data.fachrichtung}"; ` +
      `aborting to prevent wrong mandant data. Detected: ${samples.join(', ')}`,
    );
  }
  if (result === 'unverifiable' && !switchSucceeded) {
    throw new Error(
      `PKOrg role switch failed and export scope cannot be verified (no fachrichtung column found); ` +
      `aborting to prevent wrong mandant data`,
    );
  }
  if (result === 'match' && !switchSucceeded) {
    addLog(job, '✅ PKOrg switch failed, but export scope matches expected fachrichtung; continuing safely');
  }
}

// ─── Notenübersicht import ────────────────────────────────────────────────────

async function handleImportNotenuebersicht(job: Job, data: JobData) {
  addLog(job, '⏳ Starting Notenübersicht import...');
  await job.updateProgress(5);

  addLog(job, `📋 Role: ${data.roleUrl ?? '(none)'} | Fachrichtung: ${data.fachrichtung ?? '(none)'}`);

  let cookies = data.cookies;
  let switchSucceeded = true;
  if (data.roleUrl && data.roleUrl !== '#') {
    const sr = await attemptRoleSwitch(job, cookies, data.roleUrl);
    cookies = sr.cookies;
    switchSucceeded = sr.switched;
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
  if (rows.length === 0) {
    addLog(job, '⚠️ Excel is empty — nothing to import');
    await job.updateProgress(100);
    return;
  }

  // Verify the export matches the expected fachrichtung before writing any data
  assertExportScope(job, rows, data, switchSucceeded);

  // ── Column diagnostics ────────────────────────────────────────────────────
  const allColumns = Object.keys(rows[0]);
  addLog(job, `🔑 All columns (${allColumns.length}): ${allColumns.join(' | ')}`);
  addLog(job, `🔍 Row0 sample: ${JSON.stringify(rows[0])}`);

  const emailCol = detectEmailColumn(rows[0]);
  if (emailCol) {
    addLog(job, `📧 Detected HEX/PEX email column: "${emailCol}"`);
    // Show up to 5 sample email values so we can verify the column content
    const samples = rows.slice(0, 5)
      .map((r) => extractHexEmail(r, emailCol))
      .filter(Boolean);
    addLog(job, `📧 Sample email values: ${samples.join(', ') || '(all empty)'}`);
  } else {
    addLog(job, `⚠️ No HEX/PEX email column found. Tried: ${HEX_EMAIL_CANDIDATES.join(', ')}`);
    addLog(job, '⚠️ pexUserId matching will fall back to name heuristic only. ' +
      'Set EXP_SEES_FACHRICHTUNG=true as a temporary workaround if experts see 0 candidates.');
  }

  // ── Build user lookup maps ─────────────────────────────────────────────────
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const usersByEmail = new Map<string, number>();
  for (const u of allUsers) usersByEmail.set(u.email.toLowerCase(), u.id);
  addLog(job, `👥 ${allUsers.length} users loaded for matching: ${allUsers.map((u) => u.email).join(', ')}`);

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
    const kId = parseInt(row['Kandidat:in ID']);
    if (kId && !existingKandidaten.has(kId)) {
      newKandidaten.push({ id: kId, vorname: row['Vorname KAND'] ?? '', nachname: row['Nachname KAND'] ?? '' });
      existingKandidaten.add(kId);
    }

    const hexId = parseInt(row['IdHEX']);
    if (hexId && !existingHex.has(hexId)) {
      const hexMail = extractHexEmail(row, emailCol) || undefined;
      newHex.push({ id: hexId, vorname: row['VornameHEX'] ?? '', nachname: row['NachnameHEX'] ?? '', mail: hexMail });
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

  // ── Upsert Notenuebersichten ───────────────────────────────────────────────
  addLog(job, '📝 Upserting Notenuebersichten...');
  let created = 0;
  let updated = 0;
  let pexByEmail = 0;
  let pexByName = 0;
  let pexUnmatched = 0;
  let pexNoIdentifier = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const kandidatId = parseInt(row['Kandidat:in ID']);
    if (!kandidatId) continue;

    const hexEmail  = extractHexEmail(row, emailCol).toLowerCase();
    const hexVorname = (row['VornameHEX'] ?? '').toString().trim();
    const hexNachname = (row['NachnameHEX'] ?? '').toString().trim();

    // Resolution order:
    //   1. exact email match
    //   2. name heuristic (vorname + nachname vs email local part)
    //   3. no identifier available
    // For cases 2 and 3 the behaviour depends on whether an email column exists:
    //   - email col present but empty → null (user not in system)
    //   - no email col at all         → undefined (don't touch existing pexUserId)
    let resolvedPexUserId: number | null | undefined;
    let matchMethod = '';

    if (hexEmail) {
      const byEmail = usersByEmail.get(hexEmail);
      if (byEmail !== undefined) {
        resolvedPexUserId = byEmail;
        pexByEmail++;
        matchMethod = 'email';
      } else {
        // Email present but no user found → try name fallback
        const byName = matchByName(hexVorname, hexNachname, allUsers);
        if (byName !== undefined) {
          resolvedPexUserId = byName;
          pexByName++;
          matchMethod = 'name';
        } else {
          resolvedPexUserId = null;
          pexUnmatched++;
          addLog(job, `⚠️ No user for HEX email "${hexEmail}" name="${hexVorname} ${hexNachname}" (kandidat ${kandidatId})`);
        }
      }
    } else if (emailCol) {
      // Column exists but this row's value is empty — try name fallback
      const byName = matchByName(hexVorname, hexNachname, allUsers);
      if (byName !== undefined) {
        resolvedPexUserId = byName;
        pexByName++;
        matchMethod = 'name';
      } else {
        resolvedPexUserId = null;
        pexUnmatched++;
        if (pexUnmatched <= 10) {
          addLog(job, `⚠️ Empty HEX email, name fallback failed: "${hexVorname} ${hexNachname}" (kandidat ${kandidatId})`);
        }
      }
    } else {
      // No email column at all — try name only, but don't clear existing value on failure
      const byName = matchByName(hexVorname, hexNachname, allUsers);
      if (byName !== undefined) {
        resolvedPexUserId = byName;
        pexByName++;
        matchMethod = 'name';
      } else {
        resolvedPexUserId = undefined; // preserve existing pexUserId
        pexNoIdentifier++;
      }
    }

    if (matchMethod) {
      // verbose only for first 5 matches to confirm the logic is working
      if (pexByEmail + pexByName <= 5) {
        addLog(job, `✅ pex match [${matchMethod}]: kandidat ${kandidatId} → userId ${resolvedPexUserId}`);
      }
    }

    const noteData = {
      fachrichtung:         row['Fachrichtung']         ?? undefined,
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
      pexUserId:            resolvedPexUserId,
    };

    // undefined values are stripped so Prisma ignores them on updates
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
  addLog(job, `👤 pexUserId results: ${pexByEmail} by email, ${pexByName} by name heuristic, ${pexUnmatched} unmatched, ${pexNoIdentifier} had no identifier (preserved existing)`);
  if (pexByEmail === 0 && pexByName === 0 && rows.length > 0) {
    addLog(job, '❌ ZERO pexUserId matches — EXP users will see 0 candidates. ' +
      'Check column names above and verify user emails match the HEX email values in PKOrg. ' +
      'Set EXP_SEES_FACHRICHTUNG=true to unblock EXP users while debugging.');
  }

  await prisma.importRun.create({
    data: {
      importType: 'notenuebersicht',
      fachrichtung: data.fachrichtung ?? null,
      roleUrl: data.roleUrl ?? null,
      rowCount: created + updated,
      importedByUserId: data.userId ?? null,
    },
  });

  await logAction(data.userId, 'Notenübersicht imported via job');
  await job.updateProgress(100);
  addLog(job, '✅ Import complete');
}

async function handleImportDurchfuehrung(job: Job, data: JobData) {
  addLog(job, '⏳ Starting Durchführung import...');
  await job.updateProgress(5);

  addLog(job, `📋 Role: ${data.roleUrl ?? '(none)'} | Fachrichtung: ${data.fachrichtung ?? '(none)'}`);

  let cookies = data.cookies;
  let switchSucceeded = true;
  if (data.roleUrl && data.roleUrl !== '#') {
    const sr = await attemptRoleSwitch(job, cookies, data.roleUrl);
    cookies = sr.cookies;
    switchSucceeded = sr.switched;
  }

  addLog(job, '⬇️ Downloading Durchführung Excel...');
  const excelUrl = `${env.PKORG_BASE_URL}/verwaltung/301/41?nauswertungid=839`;
  const excelBuffer = await pkorgDownloadExcel(cookies, excelUrl);
  await job.updateProgress(30);

  const workbook = XLSX.read(excelBuffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet);

  addLog(job, `📋 Found ${rows.length} rows`);
  if (rows.length === 0) {
    addLog(job, '⚠️ Durchführung Excel is empty');
    await job.updateProgress(100);
    return;
  }

  // Verify the export matches the expected fachrichtung before writing any data
  assertExportScope(job, rows, data, switchSucceeded);

  // ── Column diagnostics ────────────────────────────────────────────────────
  const dfColumns = Object.keys(rows[0]);
  addLog(job, `🔑 DF columns (${dfColumns.length}): ${dfColumns.join(' | ')}`);
  addLog(job, `🔍 DF-Row0: ${JSON.stringify(rows[0])}`);

  const dfEmailCol = detectEmailColumn(rows[0]);
  if (dfEmailCol) {
    addLog(job, `📧 DF detected HEX/PEX email column: "${dfEmailCol}"`);
    const samples = rows.slice(0, 5).map((r) => extractHexEmail(r, dfEmailCol)).filter(Boolean);
    addLog(job, `📧 DF sample email values: ${samples.join(', ') || '(all empty)'}`);
  } else {
    addLog(job, `⚠️ DF: No HEX/PEX email column found. Tried: ${HEX_EMAIL_CANDIDATES.join(', ')}`);
  }

  // ── Build user lookup maps ─────────────────────────────────────────────────
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true } });
  const usersByEmail = new Map<string, number>();
  for (const u of allUsers) usersByEmail.set(u.email.toLowerCase(), u.id);
  addLog(job, `👥 ${allUsers.length} users: ${allUsers.map((u) => u.email).join(', ')}`);

  let updatedK = 0;
  let updatedV = 0;
  let dfPexByEmail = 0;
  let dfPexByName = 0;
  let dfPexUnmatched = 0;
  let dfPexNoIdentifier = 0;

  for (const row of rows) {
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

      // Supplement pexUserId from this sheet — mirrors NU logic with email + name fallback.
      const hexEmail    = extractHexEmail(row, dfEmailCol).toLowerCase();
      // PEX1 columns confirmed present in DF export; fall back to HEX naming for NU exports
      const hexVorname  = (row['Vorname PEX1'] ?? row['VornamePEX1'] ?? row['VornameHEX'] ?? row['Vorname HEX'] ?? '').toString().trim();
      const hexNachname = (row['Nachname PEX1'] ?? row['NachnamePEX1'] ?? row['NachnameHEX'] ?? row['Nachname HEX'] ?? '').toString().trim();

      let dfPexUserId: number | undefined;
      if (hexEmail) {
        const byEmail = usersByEmail.get(hexEmail);
        if (byEmail !== undefined) {
          dfPexUserId = byEmail;
          dfPexByEmail++;
        } else {
          const byName = matchByName(hexVorname, hexNachname, allUsers);
          if (byName !== undefined) {
            dfPexUserId = byName;
            dfPexByName++;
          } else {
            dfPexUnmatched++;
            if (dfPexUnmatched <= 10) {
              addLog(job, `⚠️ DF: No user for email "${hexEmail}" name="${hexVorname} ${hexNachname}" (kandidat ${kId})`);
            }
          }
        }
      } else if (dfEmailCol) {
        const byName = matchByName(hexVorname, hexNachname, allUsers);
        if (byName !== undefined) {
          dfPexUserId = byName;
          dfPexByName++;
        } else {
          dfPexUnmatched++;
        }
      } else {
        const byName = matchByName(hexVorname, hexNachname, allUsers);
        if (byName !== undefined) {
          dfPexUserId = byName;
          dfPexByName++;
        } else {
          dfPexNoIdentifier++;
        }
      }

      if (dfPexUserId !== undefined) {
        try {
          await prisma.notenuebersicht.updateMany({
            where: { kandidatId: kId },
            data: { pexUserId: dfPexUserId },
          });
        } catch { /* Notenuebersicht may not exist yet */ }
      }
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
  addLog(job, `👤 DF pexUserId: ${dfPexByEmail} by email, ${dfPexByName} by name heuristic, ${dfPexUnmatched} unmatched, ${dfPexNoIdentifier} had no identifier`);

  await prisma.importRun.create({
    data: {
      importType: 'durchfuehrung',
      fachrichtung: data.fachrichtung ?? null,
      roleUrl: data.roleUrl ?? null,
      rowCount: updatedK,
      importedByUserId: data.userId ?? null,
    },
  });

  await logAction(data.userId, 'Durchführung imported via job');
  await job.updateProgress(100);
}

async function handleDownloadPortfolios(job: Job, data: JobData) {
  addLog(job, '⏳ Starting portfolio download...');
  await job.updateProgress(0);

  addLog(job, `📋 Role: ${data.roleUrl ?? '(none)'} | Fachrichtung: ${data.fachrichtung ?? '(none)'}`);

  if (data.roleUrl && data.roleUrl !== '#') {
    const sr = await attemptRoleSwitch(job, data.cookies, data.roleUrl);
    data.cookies = sr.cookies;
    if (!sr.switched) {
      addLog(job, '⚠️ PKOrg role switch failed; portfolio download proceeds with current session scope');
    }
  }

  const nmandantid = await pkorgGetMandantId(data.cookies);
  addLog(job, `📋 Mandant ID: ${nmandantid}`);

  const portfoliosDir = data.fachrichtung
    ? path.join(env.MEDIA_DIR, 'portfolios', data.fachrichtung)
    : path.join(env.MEDIA_DIR, 'portfolios');
  fs.mkdirSync(portfoliosDir, { recursive: true });

  const kandidaten = await prisma.kandidat.findMany(
    data.fachrichtung
      ? { where: { notenuebersicht: { fachrichtung: { contains: data.fachrichtung } } } }
      : undefined,
  );
  const total = kandidaten.length;
  addLog(job, `📦 ${total} Kandidaten to process (fachrichtung: ${data.fachrichtung ?? 'all'})`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < kandidaten.length; i++) {
    const kandidat = kandidaten[i];
    const filePath = path.join(portfoliosDir, `${kandidat.id}.zip`);
    const relPath = data.fachrichtung
      ? `portfolios/${data.fachrichtung}/${kandidat.id}.zip`
      : `portfolios/${kandidat.id}.zip`;

    const existing = await prisma.portfolio.findUnique({ where: { kandidatId: kandidat.id } });

    if (existing?.status === 'downloaded' && fs.existsSync(filePath)) {
      addLog(job, `⏩ ${kandidat.id}: already downloaded`);
      skipped++;
    } else {
      await prisma.portfolio.upsert({
        where: { kandidatId: kandidat.id },
        create: { kandidatId: kandidat.id, status: 'downloading' },
        update: { status: 'downloading', error: null },
      });

      try {
        addLog(job, `⬇️ ${kandidat.id}: downloading...`);
        const buffer = await pkorgDownloadPortfolioZip(data.cookies, nmandantid, kandidat.id);
        fs.writeFileSync(filePath, buffer);

        await prisma.portfolio.update({
          where: { kandidatId: kandidat.id },
          data: { status: 'downloaded', filePath: relPath, downloadedAt: new Date(), error: null },
        });

        addLog(job, `✅ ${kandidat.id}: saved`);
        downloaded++;
      } catch (err) {
        const msg = (err as Error).message;
        await prisma.portfolio.update({
          where: { kandidatId: kandidat.id },
          data: { status: 'failed', error: msg },
        });
        addLog(job, `⚠️ ${kandidat.id}: ${msg}`);
        failed++;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    await job.updateProgress(Math.round(((i + 1) / total) * 100));
  }

  await prisma.importRun.create({
    data: {
      importType: 'portfolios',
      fachrichtung: data.fachrichtung ?? null,
      roleUrl: data.roleUrl ?? null,
      rowCount: downloaded,
      importedByUserId: data.userId ?? null,
    },
  });

  await logAction(data.userId, 'Portfolio download completed via job');
  addLog(job, `✅ All done: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed`);
}

logger.info('🔧 Worker started, waiting for jobs...');
