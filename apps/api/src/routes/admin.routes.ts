import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/database.js';
import { requireAdmin, parsePkorgFachrichtung, parsePkorgRoleType } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAction } from '../services/logService.js';
import { importQueue } from '../services/queue.js';
import { pkorgGetRoles } from '../services/pkorg/pkorgClient.js';
import { env } from '../config/env.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ─── Shared helper: scoped DB clear ──────────────────────────────────────────
/**
 * Deletes all data for a specific fachrichtung (or everything if fachrichtung is null).
 * Cleans up both DB records and associated files on disk.
 */
async function clearDataForScope(fachrichtung: string | null | undefined): Promise<void> {
  if (fachrichtung) {
    // 1. Collect Anpassungen (with file paths) for this fachrichtung before deleting
    const anpassungen = await prisma.anpassung.findMany({
      where: { notenuebersicht: { fachrichtung: { contains: fachrichtung } } },
      select: { pdfPath: true },
    });

    // 2. Delete Notenuebersichten → cascades Anpassungen in DB
    await prisma.notenuebersicht.deleteMany({
      where: { fachrichtung: { contains: fachrichtung } },
    });

    // 3. Remove orphaned persons no longer referenced by any Notenuebersicht
    await Promise.all([
      prisma.kandidat.deleteMany({ where: { notenuebersicht: null } }),
      prisma.hauptexperte.deleteMany({ where: { notenuebersichten: { none: {} } } }),
      prisma.nebenexperte.deleteMany({ where: { notenuebersichten: { none: {} } } }),
      prisma.vf.deleteMany({ where: { notenuebersichten: { none: {} } } }),
    ]);

    // 4. Remove uploaded PDF files from disk (Anpassungen)
    for (const { pdfPath } of anpassungen) {
      if (pdfPath && fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    }

    // 5. Remove portfolio + PDF files in fachrichtung subfolders
    const pdfDir = path.join(env.MEDIA_DIR, 'pdf', fachrichtung);
    const portfoliosDir = path.join(env.MEDIA_DIR, 'portfolios', fachrichtung);
    for (const dir of [pdfDir, portfoliosDir]) {
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
        }
      }
    }
  } else {
    // Global clear: all data
    const anpassungen = await prisma.anpassung.findMany({ select: { pdfPath: true } });

    await prisma.$transaction([
      prisma.anpassung.deleteMany(),
      prisma.notenuebersicht.deleteMany(),
      prisma.kandidat.deleteMany(),
      prisma.hauptexperte.deleteMany(),
      prisma.nebenexperte.deleteMany(),
      prisma.vf.deleteMany(),
    ]);

    for (const { pdfPath } of anpassungen) {
      if (pdfPath && fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    }

    const pdfDir = path.join(env.MEDIA_DIR, 'pdf');
    const portfoliosDir = path.join(env.MEDIA_DIR, 'portfolios');
    for (const dir of [pdfDir, portfoliosDir]) {
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
        }
      }
    }
  }
}

// ─── Konferenz-Status (persisted in DB via Setting model) ────────────────────
const KONFERENZ_KEY = 'konferenzStatus';
type KonferenzStatus = 'vorbereitung' | 'durchfuehrung';

async function getKonferenzStatus(): Promise<KonferenzStatus> {
  const row = await prisma.setting.findUnique({ where: { key: KONFERENZ_KEY } });
  const val = row?.value;
  return val === 'durchfuehrung' ? 'durchfuehrung' : 'vorbereitung';
}

adminRouter.get('/konferenz-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ status: await getKonferenzStatus() });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/konferenz-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    if (status !== 'vorbereitung' && status !== 'durchfuehrung') {
      res.status(400).json({ error: 'invalid_status', message: 'Status must be vorbereitung or durchfuehrung' });
      return;
    }
    await prisma.setting.upsert({
      where:  { key: KONFERENZ_KEY },
      create: { key: KONFERENZ_KEY, value: status },
      update: { value: status },
    });
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

// Export for use in other routes
export { getKonferenzStatus };

// ─── GET /api/admin/users ────────────────────────────────────────────────────
adminRouter.get('/users', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true, pkorgFachrichtung: true, pkorgRoleType: true, pkorgRoleText: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
const updateRoleSchema = z.object({
  role: z.enum(['USER', 'VEX', 'STAFF', 'ADMIN']),
});

adminRouter.patch('/users/:id/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role } = updateRoleSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true, createdAt: true, pkorgFachrichtung: true, pkorgRoleType: true, pkorgRoleText: true },
    });

    await logAction(req.session.userId!, `Changed role of ${user.email} to ${role}`);

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/users/:id/fachrichtung ─────────────────────────────────
const updateFachrichtungSchema = z.object({
  pkorgFachrichtung: z.string().nullable(),
  pkorgRoleType: z.string().nullable().optional(),
  pkorgRoleText: z.string().nullable().optional(),
});

adminRouter.patch('/users/:id/fachrichtung', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const data = updateFachrichtungSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, role: true, createdAt: true, pkorgFachrichtung: true, pkorgRoleType: true, pkorgRoleText: true },
    });

    await logAction(req.session.userId!, `Updated PKOrg fachrichtung of ${user.email} to ${data.pkorgFachrichtung}`);

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/admin/users/:id ─────────────────────────────────────────────
adminRouter.delete('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseInt(req.params.id, 10);

    // Prevent self-deletion
    if (userId === req.session.userId) {
      throw new AppError(400, 'cannot_delete_self', 'Cannot delete your own account');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(404, 'not_found', 'User not found');
    }

    await prisma.user.delete({ where: { id: userId } });
    await logAction(req.session.userId!, `Deleted user ${user.email}`);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/logs ─────────────────────────────────────────────────────
const logsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
});

adminRouter.get('/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize } = logsQuerySchema.parse(req.query);
    const skip = (page - 1) * pageSize;

    const [logs, total] = await Promise.all([
      prisma.log.findMany({
        include: { user: { select: { id: true, email: true, role: true, createdAt: true } } },
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.log.count(),
    ]);

    res.json({
      items: logs,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/pkorg/debug-html ─────────────────────────────────────────
adminRouter.get('/pkorg/debug-html', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cookies = req.session.pkorgCookies;
    if (!cookies) throw new AppError(400, 'no_pkorg_session', 'No PKOrg session');
    const response = await fetch(`${process.env.PKORG_BASE_URL ?? 'https://2026.pkorg.ch'}/`, {
      headers: {
        Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        'User-Agent': 'Mozilla/5.0',
      },
      redirect: 'manual',
    });
    const html = await response.text();
    const idx = html.indexOf('affiliations');
    res.json({
      status: response.status,
      htmlLength: html.length,
      affiliationsFound: idx !== -1,
      affiliationsContext: idx !== -1 ? html.substring(Math.max(0, idx - 50), idx + 500) : null,
      htmlPreview: html.substring(0, 500),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/pkorg/roles ──────────────────────────────────────────────
adminRouter.get('/pkorg/roles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session. Please login with 2FA first.');
    }

    const roles = await pkorgGetRoles(cookies);
    req.session.pkorgRoles = roles;
    req.session.lastPkorgPing = new Date().toISOString();

    // Auto-select first role if none is active yet
    if (!req.session.activePkorgRole && roles.length > 0) {
      req.session.activePkorgRole = roles[0];
      req.session.activePkorgFachrichtung = parsePkorgFachrichtung(roles[0].text);
      req.session.activePkorgRoleType = parsePkorgRoleType(roles[0].text);
    }

    res.json({
      roles,
      activePkorgRole: req.session.activePkorgRole ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/pkorg/switch-role ───────────────────────────────────────
// Mirrors Django's switch_user_role() + admin_dashboard_handler().
// Switches the active PKOrg context (updates cookies server-side) and stores
// the chosen role in the session so all subsequent imports use it automatically.
const switchPkorgRoleSchema = z.object({
  roleUrl: z.string().min(1),
});

adminRouter.post('/pkorg/switch-role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roleUrl } = switchPkorgRoleSchema.parse(req.body);
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session. Please login with 2FA first.');
    }

    // Find the matching role object from the cached list (for the text label)
    const matched = (req.session.pkorgRoles ?? []).find((r) => r.url === roleUrl)
      ?? { text: roleUrl, url: roleUrl };

    // Always update the local session filter immediately — this drives dossier visibility
    req.session.activePkorgRole = matched;
    req.session.activePkorgFachrichtung = parsePkorgFachrichtung(matched.text);
    req.session.activePkorgRoleType = parsePkorgRoleType(matched.text);
    req.session.lastPkorgPing = new Date().toISOString();

    // Best-effort: attempt the actual PKOrg session switch (for imports/downloads).
    // PKOrg uses AngularJS internally so HTTP GET switches may not work — we log and continue.
    const { pkorgSwitchRole } = await import('../services/pkorg/pkorgClient.js');
    const { cookies: updatedCookies, switched } = await pkorgSwitchRole(cookies, roleUrl);
    if (switched) {
      req.session.pkorgCookies = updatedCookies;
    }

    await logAction(req.session.userId!, `Switched PKOrg role to: ${matched.text} (pkorg=${switched})`);

    res.json({
      activePkorgRole: matched,
      availableRoles: req.session.pkorgRoles ?? [],
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/imports/notenuebersicht ─────────────────────────────────
const importActionSchema = z.object({
  roleUrl: z.string().optional(),
});

adminRouter.post('/imports/notenuebersicht', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!importQueue) {
      res.status(503).json({ error: 'queue_unavailable', message: 'Job queue unavailable: REDIS_URL is not configured.' });
      return;
    }
    const { roleUrl: explicitRoleUrl } = importActionSchema.parse(req.body);
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session');
    }

    // Use explicitly provided URL, fall back to the active PKOrg role in session
    const roleUrl = explicitRoleUrl ?? req.session.activePkorgRole?.url;

    const job = await importQueue.add('import_notenuebersicht', {
      cookies,
      roleUrl,
      userId: req.session.userId,
      fachrichtung: req.session.activePkorgFachrichtung ?? undefined,
    });

    res.json({ jobId: job.id, status: 'queued', usingRole: req.session.activePkorgRole?.text ?? null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/imports/durchfuehrung ───────────────────────────────────
adminRouter.post('/imports/durchfuehrung', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!importQueue) {
      res.status(503).json({ error: 'queue_unavailable', message: 'Job queue unavailable: REDIS_URL is not configured.' });
      return;
    }
    const { roleUrl: explicitRoleUrl } = importActionSchema.parse(req.body);
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session');
    }

    const roleUrl = explicitRoleUrl ?? req.session.activePkorgRole?.url;

    const job = await importQueue.add('import_durchfuehrung', {
      cookies,
      roleUrl,
      userId: req.session.userId,
      fachrichtung: req.session.activePkorgFachrichtung ?? undefined,
    });

    res.json({ jobId: job.id, status: 'queued', usingRole: req.session.activePkorgRole?.text ?? null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/portfolios/download ─────────────────────────────────────
adminRouter.post('/portfolios/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!importQueue) {
      res.status(503).json({ error: 'queue_unavailable', message: 'Job queue unavailable: REDIS_URL is not configured.' });
      return;
    }
    const { roleUrl: explicitRoleUrl } = importActionSchema.parse(req.body);
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session');
    }

    const roleUrl = explicitRoleUrl ?? req.session.activePkorgRole?.url;

    const job = await importQueue.add('download_portfolios', {
      cookies,
      roleUrl,
      userId: req.session.userId,
      fachrichtung: req.session.activePkorgFachrichtung ?? undefined,
    });

    res.json({ jobId: job.id, status: 'queued', usingRole: req.session.activePkorgRole?.text ?? null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/imports/drain ───────────────────────────────────────────
// Removes all failed and waiting jobs so the queue is clean for fresh imports.
adminRouter.post('/imports/drain', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!importQueue) {
      res.status(503).json({ error: 'queue_unavailable', message: 'Job queue unavailable: REDIS_URL is not configured.' });
      return;
    }
    // clean(gracePeriod, limit, state)
    const [failedCount, waitingCount] = await Promise.all([
      importQueue.clean(0, 1000, 'failed'),
      importQueue.clean(0, 1000, 'wait'),
    ]);
    res.json({ removed: { failed: failedCount.length, waiting: waitingCount.length } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/empty-database ──────────────────────────────────────────
adminRouter.post('/empty-database', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fachrichtung = req.session.activePkorgFachrichtung;
    await clearDataForScope(fachrichtung);
    await logAction(req.session.userId!, fachrichtung ? `Database cleared for fachrichtung: ${fachrichtung}` : 'Database cleared (global)');
    res.json({ status: 'ok', scope: fachrichtung ?? 'global' });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/keepalive ────────────────────────────────────────────────
adminRouter.get('/keepalive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session');
    }

    // Import dynamically to keep the route file clean
    const { pkorgPing } = await import('../services/pkorg/pkorgClient.js');
    const ok = await pkorgPing(cookies);

    if (ok) {
      req.session.lastPkorgPing = new Date().toISOString();
    }

    res.json({ status: ok ? 'ok' : 'failed', lastPing: req.session.lastPkorgPing });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/last-ping ────────────────────────────────────────────────
adminRouter.get('/last-ping', (req: Request, res: Response) => {
  res.json({ lastPing: req.session.lastPkorgPing ?? '2000-01-01T00:00:00' });
});

// ─── GET /api/admin/debug/session ────────────────────────────────────────────
// Diagnostic endpoint: shows session identity + pexUserId coverage for the
// currently logged-in admin. Use to verify matching worked after an import.
adminRouter.get('/debug/session', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session.userId!;
    const fachrichtung = req.session.activePkorgFachrichtung ?? null;

    const [pexCount, fachrichtungCount, totalCount, sampleAssigned] = await Promise.all([
      prisma.notenuebersicht.count({ where: { pexUserId: userId } }),
      fachrichtung
        ? prisma.notenuebersicht.count({ where: { fachrichtung: { contains: fachrichtung } } })
        : Promise.resolve(null),
      prisma.notenuebersicht.count(),
      prisma.notenuebersicht.findMany({
        where: { pexUserId: { not: null } },
        select: {
          kandidatId: true,
          fachrichtung: true,
          pexUserId: true,
          pexUser: { select: { email: true } },
        },
        take: 10,
        orderBy: { kandidatId: 'asc' },
      }),
    ]);

    const nullPexCount = await prisma.notenuebersicht.count({ where: { pexUserId: null } });

    res.json({
      session: {
        userId,
        activePkorgRoleType:      req.session.activePkorgRoleType      ?? null,
        activePkorgFachrichtung:  fachrichtung,
        activePkorgRole:          req.session.activePkorgRole           ?? null,
      },
      counts: {
        total:              totalCount,
        assignedToThisUser: pexCount,
        inFachrichtung:     fachrichtungCount,
        withAnyPexUserId:   totalCount - nullPexCount,
        withNullPexUserId:  nullPexCount,
      },
      sampleAssigned,
      flags: {
        expSeesFachrichtung: env.EXP_SEES_FACHRICHTUNG ?? false,
      },
    });
  } catch (err) {
    next(err);
  }
});
