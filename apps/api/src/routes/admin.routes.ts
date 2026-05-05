import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAction } from '../services/logService.js';
import { importQueue } from '../services/queue.js';
import { pkorgGetRoles } from '../services/pkorg/pkorgClient.js';
import { env } from '../config/env.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ─── GET /api/admin/users ────────────────────────────────────────────────────
adminRouter.get('/users', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────────
const updateRoleSchema = z.object({
  role: z.enum(['USER', 'STAFF', 'ADMIN']),
});

adminRouter.patch('/users/:id/role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role } = updateRoleSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    await logAction(req.session.userId!, `Changed role of ${user.email} to ${role}`);

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

// ─── GET /api/admin/pkorg/roles ──────────────────────────────────────────────
adminRouter.get('/pkorg/roles', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session. Please login with 2FA first.');
    }

    const roles = await pkorgGetRoles(cookies);
    req.session.lastPkorgPing = new Date().toISOString();

    res.json({ roles });
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
    const { roleUrl } = importActionSchema.parse(req.body);
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session');
    }

    const job = await importQueue.add('import_notenuebersicht', {
      cookies,
      roleUrl,
      userId: req.session.userId,
    });

    res.json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/imports/durchfuehrung ───────────────────────────────────
adminRouter.post('/imports/durchfuehrung', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roleUrl } = importActionSchema.parse(req.body);
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session');
    }

    const job = await importQueue.add('import_durchfuehrung', {
      cookies,
      roleUrl,
      userId: req.session.userId,
    });

    res.json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/portfolios/download ─────────────────────────────────────
adminRouter.post('/portfolios/download', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roleUrl } = importActionSchema.parse(req.body);
    const cookies = req.session.pkorgCookies;
    if (!cookies) {
      throw new AppError(400, 'no_pkorg_session', 'No PKOrg session');
    }

    const job = await importQueue.add('download_portfolios', {
      cookies,
      roleUrl,
      userId: req.session.userId,
    });

    res.json({ jobId: job.id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/empty-database ──────────────────────────────────────────
adminRouter.post('/empty-database', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.$transaction([
      prisma.anpassung.deleteMany(),
      prisma.notenuebersicht.deleteMany(),
      prisma.kandidat.deleteMany(),
      prisma.hauptexperte.deleteMany(),
      prisma.nebenexperte.deleteMany(),
      prisma.vf.deleteMany(),
    ]);

    await logAction(req.session.userId!, 'Database cleared');

    // Clean up file storage (portfolios + PDFs)
    const pdfDir = path.join(env.MEDIA_DIR, 'pdf');
    const portfoliosDir = path.join(env.MEDIA_DIR, 'portfolios');

    for (const dir of [pdfDir, portfoliosDir]) {
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        }
      }
    }

    res.json({ status: 'ok' });
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
