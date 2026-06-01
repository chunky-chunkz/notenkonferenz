import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { requireAuth, requireVex, effectiveRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAction } from '../services/logService.js';
import { uploadPdf } from '../middleware/upload.js';

export const itemsRouter = Router();

// All item routes require at least VEX (VEX, STAFF, ADMIN)
itemsRouter.use(requireVex);

/**
 * Build a filter clause based on the active PKOrg role in the session.
 *
 * PKOrg role types:
 *  - EXP  → Experte: can only see their own IPA (pexUserId === userId)
 *  - CEX  → sees all items within their fachrichtung
 *  - VEX  → sees all items within their fachrichtung
 *  - ADMIN/STAFF without PKOrg fachrichtung → ADMIN sees all, STAFF sees nothing
 */
function buildFachrichtungFilter(req: Request): object | undefined {
  const keyword = req.session.activePkorgFachrichtung;
  const pkorgRoleType = req.session.activePkorgRoleType; // 'EXP' | 'CEX' | 'VEX' | 'BB' | null

  // EXP (Experte): only their own assigned IPA
  if (pkorgRoleType === 'EXP') {
    const base: any = { pexUserId: req.session.userId };
    if (keyword) base.fachrichtung = { contains: keyword };
    return base;
  }

  // CEX/VEX and others: scoped to fachrichtung if set
  if (keyword) return { fachrichtung: { contains: keyword } };

  const role = effectiveRole(req);

  // ADMIN without any PKOrg fachrichtung sees everything
  if (role === 'ADMIN') return undefined;

  // VEX and STAFF without an active PKOrg fachrichtung see nothing
  return { kandidatId: -1 };
}

// ─── GET /api/items (list + filter + pagination) ─────────────────────────────
const itemsFilterSchema = z.object({
  kandidatId: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
  noteMin: z.string().optional(),
  noteMax: z.string().optional(),
  hauptexperte: z.string().optional(),
  vf: z.string().optional(),
  nebenexperte: z.string().optional(),
  nkVisiert: z.enum(['true', 'false']).optional(),
  nkChange: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
});

itemsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = itemsFilterSchema.parse(req.query);
    const skip = (filters.page - 1) * filters.pageSize;

    // Build where clause dynamically
    const where: any = {};

    // Always scope to active PKOrg fachrichtung if set
    const fachrichtungFilter = buildFachrichtungFilter(req);
    if (fachrichtungFilter) {
      Object.assign(where, fachrichtungFilter);
    }

    if (filters.kandidatId) {
      where.kandidatId = { equals: parseInt(filters.kandidatId, 10) || undefined };
    }
    if (filters.name) {
      where.OR = [
        { kandidat: { vorname: { contains: filters.name } } },
        { kandidat: { nachname: { contains: filters.name } } },
      ];
    }
    if (filters.note) {
      const noteVal = parseFloat(filters.note);
      if (!isNaN(noteVal)) {
        where.notePaErrechnet = { equals: noteVal };
      }
    }
    // Range filter: noteMin/noteMax (overrides exact note if both present)
    if (filters.noteMin || filters.noteMax) {
      const range: any = {};
      if (filters.noteMin) { const v = parseFloat(filters.noteMin); if (!isNaN(v)) range.gte = v; }
      if (filters.noteMax) { const v = parseFloat(filters.noteMax); if (!isNaN(v)) range.lte = v; }
      if (Object.keys(range).length > 0) where.notePaErrechnet = range;
    }
    if (filters.hauptexperte) {
      where.hauptexperte = {
        OR: [
          { vorname: { contains: filters.hauptexperte } },
          { nachname: { contains: filters.hauptexperte } },
        ],
      };
    }
    if (filters.vf) {
      where.vf = {
        OR: [
          { vorname: { contains: filters.vf } },
          { nachname: { contains: filters.vf } },
        ],
      };
    }
    if (filters.nebenexperte) {
      where.nebenexperte = {
        OR: [
          { vorname: { contains: filters.nebenexperte } },
          { nachname: { contains: filters.nebenexperte } },
        ],
      };
    }
    if (filters.nkVisiert !== undefined) {
      where.nkVisiert = filters.nkVisiert === 'true';
    }
    if (filters.nkChange !== undefined) {
      where.nkChange = filters.nkChange === 'true';
    }

    const [items, total] = await Promise.all([
      prisma.notenuebersicht.findMany({
        where,
        include: {
          kandidat: true,
          hauptexperte: true,
          nebenexperte: true,
          vf: true,
          pexUser: { select: { id: true, email: true, role: true, createdAt: true } },
        },
        skip,
        take: filters.pageSize,
        orderBy: { id: 'asc' },
      }),
      prisma.notenuebersicht.count({ where }),
    ]);

    res.json({
      items,
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages: Math.ceil(total / filters.pageSize),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/items/my (items assigned to current user) ──────────────────────
itemsRouter.get('/my', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fachrichtungFilter = buildFachrichtungFilter(req);
    const items = await prisma.notenuebersicht.findMany({
      where: { pexUserId: req.session.userId, ...fachrichtungFilter },
      include: {
        kandidat: true,
        hauptexperte: true,
        nebenexperte: true,
        vf: true,
        pexUser: { select: { id: true, email: true, role: true, createdAt: true } },
      },
      orderBy: { nkVisiert: 'asc' },
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/items/submitted (abgegebene, noch nicht visierte Dossiers) ──────
itemsRouter.get('/submitted', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fachrichtungFilter = buildFachrichtungFilter(req);
    const pkorgRoleType = req.session.activePkorgRoleType;

    // CEX sees only dossiers that experts have visiert (ready for conference).
    // EXP/VEX see their own submitted/visiert items (scoped by fachrichtungFilter).
    const statusFilter: object = pkorgRoleType === 'CEX'
      ? { nkVisiert: true }
      : { OR: [{ nkAbgegeben: true }, { nkVisiert: true }] };

    const items = await (prisma.notenuebersicht as any).findMany({
      where: {
        ...statusFilter,
        ...fachrichtungFilter,
      },
      include: {
        kandidat: true,
        hauptexperte: true,
        nebenexperte: true,
        vf: true,
        pexUser: { select: { id: true, email: true, role: true, createdAt: true } },
      },
      orderBy: [{ nkVisiert: 'asc' }, { kandidatId: 'asc' }],
    });

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/items/missing-grades ───────────────────────────────────────────
itemsRouter.get('/missing-grades', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = itemsFilterSchema.parse(req.query);
    const skip = (filters.page - 1) * filters.pageSize;

    const fachrichtungFilter = buildFachrichtungFilter(req);

    // Show items that are not yet validated — regardless of whether they have a note
    const where: any = fachrichtungFilter
      ? { nkVisiert: false, ...fachrichtungFilter }
      : { nkVisiert: false };

    if (filters.kandidatId) {
      where.kandidatId = parseInt(filters.kandidatId, 10);
    }
    if (filters.name) {
      where.OR = [
        { kandidat: { vorname: { contains: filters.name } } },
        { kandidat: { nachname: { contains: filters.name } } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.notenuebersicht.findMany({
        where,
        include: {
          kandidat: true,
          hauptexperte: true,
          nebenexperte: true,
          vf: true,
        },
        skip,
        take: filters.pageSize,
      }),
      prisma.notenuebersicht.count({ where }),
    ]);

    res.json({
      items,
      total,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages: Math.ceil(total / filters.pageSize),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/items/:kandidatId/submit ──────────────────────────────────────
itemsRouter.post('/:kandidatId/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);
    const userId = req.session.userId!;
    const role = effectiveRole(req);

    // Find item — EXP/VEX must own it; ADMIN/STAFF can submit any
    const where =
      role === 'ADMIN' || role === 'STAFF'
        ? { kandidatId }
        : { kandidatId, pexUserId: userId };

    const item = await prisma.notenuebersicht.findFirst({ where, include: { kandidat: true } });
    if (!item) {
      throw new AppError(404, 'not_found', 'Dossier nicht gefunden oder nicht zugewiesen');
    }
    if (item.nkVisiert) {
      throw new AppError(400, 'already_validated', 'Dossier ist bereits validiert');
    }

    const before = JSON.stringify(item);
    const updated = await (prisma.notenuebersicht as any).update({
      where: { id: item.id },
      data: { nkAbgegeben: true },
    });

    await logAction(userId, `Submitted dossier for ${item.kandidat?.nachname}`, before, JSON.stringify(updated));
    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/items/:kandidatId/visieren ─────────────────────────────────────
itemsRouter.post('/:kandidatId/visieren', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);
    const userId = req.session.userId!;
    const role = effectiveRole(req);
    const pkorgRoleType = req.session.activePkorgRoleType;

    // ADMIN/STAFF: any dossier
    // CEX: any dossier in their fachrichtung (they oversee all experts)
    // EXP/VEX: only their own assigned dossier
    let where: any;
    if (role === 'ADMIN' || role === 'STAFF') {
      where = { kandidatId };
    } else if (pkorgRoleType === 'CEX') {
      const fachrichtungFilter = buildFachrichtungFilter(req);
      where = { kandidatId, ...fachrichtungFilter };
    } else {
      where = { kandidatId, pexUserId: userId };
    }

    const item = await prisma.notenuebersicht.findFirst({ where, include: { kandidat: true } });
    if (!item) {
      throw new AppError(404, 'not_found', 'Dossier nicht gefunden oder nicht zugewiesen');
    }
    if ((item as any).nkVisiert) {
      throw new AppError(400, 'already_validated', 'Dossier ist bereits visiert');
    }

    const before = JSON.stringify(item);
    const updated = await (prisma.notenuebersicht as any).update({
      where: { id: item.id },
      data: { nkVisiert: true, nkAbgegeben: true, nkTimestamp: new Date() },
    });

    await logAction(userId, `Visiert dossier for ${item.kandidat?.nachname}`, before, JSON.stringify(updated));
    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/items/:kandidatId ──────────────────────────────────────────────
itemsRouter.get('/:kandidatId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);
    const item = await prisma.notenuebersicht.findUnique({
      where: { kandidatId },
      include: {
        kandidat: true,
        hauptexperte: true,
        nebenexperte: true,
        vf: true,
        pexUser: { select: { id: true, email: true, role: true, createdAt: true } },
        anpassungen: true,
      },
    });

    if (!item) {
      throw new AppError(404, 'not_found', 'Item not found');
    }

    res.json({ item });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/items/collect ─────────────────────────────────────────────────
const collectSchema = z.object({
  typ: z.enum(['ungenuegend', 'knapp', 'gut', 'sehrgut']),
});

// ─── POST /api/items/collect-random ──────────────────────────────────────────
itemsRouter.post('/collect-random', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session.userId!;
    const fachrichtungFilter = buildFachrichtungFilter(req);

    // Optional note range filter
    const noteMin = req.body.noteMin !== undefined ? parseFloat(req.body.noteMin) : undefined;
    const noteMax = req.body.noteMax !== undefined ? parseFloat(req.body.noteMax) : undefined;
    const noteFilter = (noteMin !== undefined || noteMax !== undefined)
      ? { notePaErrechnet: { gte: noteMin, lte: noteMax } }
      : {};

    // Find random unassigned + not-yet-validated item
    let candidates = await prisma.notenuebersicht.findMany({
      where: {
        pexUserId: null,
        nkVisiert: false,
        ...noteFilter,
        ...fachrichtungFilter,
      },
      take: 20,
    });

    // Fallback: if no candidates match the note range, pick any available dossier
    if (candidates.length === 0 && Object.keys(noteFilter).length > 0) {
      candidates = await prisma.notenuebersicht.findMany({
        where: {
          pexUserId: null,
          nkVisiert: false,
          ...fachrichtungFilter,
        },
        take: 20,
      });
    }

    if (candidates.length === 0) {
      throw new AppError(404, 'no_items', 'Keine verfügbaren Dossiers in diesem Bereich');
    }

    const item = candidates[Math.floor(Math.random() * candidates.length)];

    const updated = await prisma.notenuebersicht.update({
      where: { id: item.id },
      data: { pexUserId: userId },
      include: { kandidat: true },
    });

    await logAction(userId, `Collected random item for ${updated.kandidat?.nachname}`, null, JSON.stringify(updated));

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

itemsRouter.post('/collect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session.userId!;
    const { typ } = collectSchema.parse(req.body);
    const fachrichtungFilter = buildFachrichtungFilter(req);

    // Check if user has open (non-visiert) items within the current fachrichtung
    // nkAbgegeben: false — bereits bestätigte Dossiers zählen nicht mehr als "offen"
    const openItems = await (prisma.notenuebersicht as any).count({
      where: { pexUserId: userId, nkVisiert: false, nkAbgegeben: false, ...fachrichtungFilter },
    });
    if (openItems > 0) {
      throw new AppError(400, 'has_open_items', 'Bitte zuerst offene Dossiers abschliessen');
    }

    // Grade ranges
    const ranges: Record<string, { gte: number; lte: number }> = {
      ungenuegend: { gte: 0, lte: 3.9 },
      knapp: { gte: 4.0, lte: 4.3 },
      gut: { gte: 4.4, lte: 5.7 },
      sehrgut: { gte: 5.8, lte: 6.0 },
    };
    const range = ranges[typ];

    // Find random unassigned item in range
    // Using raw query for random selection to avoid full table scan
    const candidates = await prisma.notenuebersicht.findMany({
      where: {
        pexUserId: null,
        notePaErrechnet: { gte: range.gte, lte: range.lte },
        ...fachrichtungFilter,
      },
      take: 10,
    });

    if (candidates.length === 0) {
      throw new AppError(404, 'no_items', 'No available items in this category');
    }

    // Pick random from candidates
    const item = candidates[Math.floor(Math.random() * candidates.length)];

    const updated = await prisma.notenuebersicht.update({
      where: { id: item.id },
      data: { pexUserId: userId },
      include: { kandidat: true },
    });

    await logAction(userId, `Collected item for ${updated.kandidat?.nachname}`, null, JSON.stringify(updated));

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/items/:kandidatId/drop ────────────────────────────────────────
itemsRouter.post('/:kandidatId/drop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);
    const userId = req.session.userId!;
    const role = effectiveRole(req);

    const where =
      role === 'ADMIN' || role === 'STAFF'
        ? { kandidatId }
        : { kandidatId, pexUserId: userId };

    const item = await prisma.notenuebersicht.findFirst({ where });

    if (!item) {
      throw new AppError(404, 'not_found', 'Item not found or not assigned to you');
    }

    await prisma.notenuebersicht.update({
      where: { id: item.id },
      data: { pexUserId: null },
    });

    await logAction(userId, `Dropped item ${kandidatId}`);

    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/items/:kandidatId/comment ────────────────────────────────────
const commentSchema = z.object({
  nkComment: z.string().nullable().optional(),
});

itemsRouter.patch('/:kandidatId/comment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);
    const userId = req.session.userId!;
    const { nkComment } = commentSchema.parse(req.body);

    const item = await prisma.notenuebersicht.findFirst({
      where: { kandidatId, pexUserId: userId },
      include: { kandidat: true },
    });

    if (!item) {
      throw new AppError(404, 'not_found', 'Item not found or not assigned to you');
    }

    const before = JSON.stringify(item);
    const updated = await prisma.notenuebersicht.update({
      where: { id: item.id },
      data: {
        nkComment: nkComment ?? null,
        nkTimestamp: new Date(),
      },
    });

    await logAction(
      userId,
      `Comment updated for ${item.kandidat?.nachname}`,
      before,
      JSON.stringify(updated),
    );

    res.json({ item: updated });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/items/:kandidatId/change (with PDF upload) ────────────────────
itemsRouter.post(
  '/:kandidatId/change',
  uploadPdf.single('pdf'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kandidatId = parseInt(req.params.kandidatId, 10);
      const userId = req.session.userId!;

      const item = await prisma.notenuebersicht.findFirst({
        where: { kandidatId, pexUserId: userId },
        include: { kandidat: true },
      });

      if (!item) {
        throw new AppError(404, 'not_found', 'Item not found or not assigned to you');
      }

      const before = JSON.stringify(item);

      // Create Anpassung with uploaded PDF
      const pdfPath = req.file?.path ?? null;
      await prisma.anpassung.create({
        data: {
          notenuebersichtId: item.id,
          pdfPath,
        },
      });

      const updated = await (prisma.notenuebersicht as any).update({
        where: { id: item.id },
        data: { nkAbgegeben: true, nkVisiert: true, nkChange: true },
      });

      await logAction(userId, `Changed ${item.kandidat?.nachname}`, before, JSON.stringify(updated));

      res.json({ item: updated });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/items/:kandidatId/grade ───────────────────────────────────────
const gradeSchema = z.object({
  note: z.number().min(0).max(6),
});

itemsRouter.post('/:kandidatId/grade', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);
    const { note } = gradeSchema.parse(req.body);
    const userId = req.session.userId!;

    const item = await prisma.notenuebersicht.findUnique({
      where: { kandidatId },
      include: { kandidat: true },
    });

    if (!item) {
      throw new AppError(404, 'not_found', 'Item not found');
    }

    const before = JSON.stringify(item);
    const updated = await prisma.notenuebersicht.update({
      where: { id: item.id },
      data: { notePaErrechnet: note },
    });

    await logAction(userId, `Set grade for ${item.kandidat?.nachname}: ${note}`, before, JSON.stringify(updated));

    res.json({ status: 'ok', item: updated });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/items/:kandidatId/grades ─────────────────────────────────────
const detailGradesSchema = z.object({
  punkteTeil1:    z.number().int().nullable().optional(),
  punkteTeil2:    z.number().int().nullable().optional(),
  punkteTeil3:    z.number().int().nullable().optional(),
  noteTeil1:      z.number().nullable().optional(),
  noteTeil2:      z.number().nullable().optional(),
  noteTeil3:      z.number().nullable().optional(),
  punkteTeil1Vf:  z.number().int().nullable().optional(),
  punkteTeil2Vf:  z.number().int().nullable().optional(),
  noteTeil1Vf:    z.number().nullable().optional(),
  noteTeil2Vf:    z.number().nullable().optional(),
  notePaErrechnet: z.number().nullable().optional(),
});

itemsRouter.patch('/:kandidatId/grades', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);
    const data = detailGradesSchema.parse(req.body);
    const userId = req.session.userId!;

    const item = await prisma.notenuebersicht.findUnique({ where: { kandidatId }, include: { kandidat: true } });
    if (!item) throw new AppError(404, 'not_found', 'Item not found');

    const before = JSON.stringify(item);
    const updated = await prisma.notenuebersicht.update({
      where: { id: item.id },
      data,
    });

    await logAction(userId, `Updated grades for ${item.kandidat?.nachname}`, before, JSON.stringify(updated));
    res.json({ status: 'ok', item: updated });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/items/dashboard/stats ──────────────────────────────────────────
itemsRouter.get('/dashboard/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fr = buildFachrichtungFilter(req) ?? {};

    const [
      numIpaAll,
      numIpaAllVis,
      numIpaUng,
      numIpaUngVis,
      numIpaKnapp,
      numIpaKnappVis,
      numIpaGut,
      numIpaGutVis,
      numIpaSehr,
      numIpaSehrVis,
    ] = await Promise.all([
      prisma.notenuebersicht.count({ where: { ...fr } }),
      prisma.notenuebersicht.count({ where: { ...fr, nkVisiert: false } }),
      prisma.notenuebersicht.count({ where: { ...fr, notePaErrechnet: { gte: 0, lte: 3.9 } } }),
      prisma.notenuebersicht.count({ where: { ...fr, notePaErrechnet: { gte: 0, lte: 3.9 }, nkVisiert: false } }),
      prisma.notenuebersicht.count({ where: { ...fr, notePaErrechnet: { gte: 4.0, lte: 4.3 } } }),
      prisma.notenuebersicht.count({ where: { ...fr, notePaErrechnet: { gte: 4.0, lte: 4.3 }, nkVisiert: false } }),
      prisma.notenuebersicht.count({ where: { ...fr, notePaErrechnet: { gte: 4.4, lte: 5.7 } } }),
      prisma.notenuebersicht.count({ where: { ...fr, notePaErrechnet: { gte: 4.4, lte: 5.7 }, nkVisiert: false } }),
      prisma.notenuebersicht.count({ where: { ...fr, notePaErrechnet: { gte: 5.8, lte: 6.0 } } }),
      prisma.notenuebersicht.count({ where: { ...fr, notePaErrechnet: { gte: 5.8, lte: 6.0 }, nkVisiert: false } }),
    ]);

    const workingOn = await prisma.notenuebersicht.findMany({
      where: { ...fr, nkVisiert: false, pexUserId: { not: null } },
      include: {
        kandidat: true,
        pexUser: { select: { id: true, email: true, role: true, createdAt: true } },
      },
    });

    const visiert = await prisma.notenuebersicht.findMany({
      where: { ...fr, nkVisiert: true },
      include: { kandidat: true },
    });

    res.json({
      numIpaAll, numIpaAllVis,
      numIpaUng, numIpaUngVis,
      numIpaKnapp, numIpaKnappVis,
      numIpaGut, numIpaGutVis,
      numIpaSehr, numIpaSehrVis,
      workingOn,
      visiert,
    });
  } catch (err) {
    next(err);
  }
});
