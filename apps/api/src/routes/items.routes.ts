import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAction } from '../services/logService.js';
import { uploadPdf } from '../middleware/upload.js';

export const itemsRouter = Router();

// All item routes require at least staff
itemsRouter.use(requireStaff);

// ─── GET /api/items (list + filter + pagination) ─────────────────────────────
const itemsFilterSchema = z.object({
  kandidatId: z.string().optional(),
  name: z.string().optional(),
  note: z.string().optional(),
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
    const items = await prisma.notenuebersicht.findMany({
      where: { pexUserId: req.session.userId },
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

// ─── GET /api/items/missing-grades ───────────────────────────────────────────
itemsRouter.get('/missing-grades', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = itemsFilterSchema.parse(req.query);
    const skip = (filters.page - 1) * filters.pageSize;

    const where: any = { notePaErrechnet: null };

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

itemsRouter.post('/collect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.session.userId!;
    const { typ } = collectSchema.parse(req.body);

    // Check if user has open (non-visiert) items
    const openItems = await prisma.notenuebersicht.count({
      where: { pexUserId: userId, nkVisiert: false },
    });
    if (openItems > 0) {
      throw new AppError(400, 'has_open_items', 'Please complete open items first');
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

// ─── POST /api/items/:kandidatId/validate ────────────────────────────────────
itemsRouter.post('/:kandidatId/validate', async (req: Request, res: Response, next: NextFunction) => {
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
    const updated = await prisma.notenuebersicht.update({
      where: { id: item.id },
      data: { nkVisiert: true, nkChange: false },
    });

    await logAction(userId, `Validated ${item.kandidat?.nachname}`, before, JSON.stringify(updated));

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

    const item = await prisma.notenuebersicht.findFirst({
      where: { kandidatId, pexUserId: userId },
    });

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

      const updated = await prisma.notenuebersicht.update({
        where: { id: item.id },
        data: { nkVisiert: true, nkChange: true },
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

// ─── GET /api/items/dashboard/stats ──────────────────────────────────────────
itemsRouter.get('/dashboard/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
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
      prisma.notenuebersicht.count(),
      prisma.notenuebersicht.count({ where: { nkVisiert: false } }),
      prisma.notenuebersicht.count({ where: { notePaErrechnet: { gte: 0, lte: 3.9 } } }),
      prisma.notenuebersicht.count({ where: { notePaErrechnet: { gte: 0, lte: 3.9 }, nkVisiert: false } }),
      prisma.notenuebersicht.count({ where: { notePaErrechnet: { gte: 4.0, lte: 4.3 } } }),
      prisma.notenuebersicht.count({ where: { notePaErrechnet: { gte: 4.0, lte: 4.3 }, nkVisiert: false } }),
      prisma.notenuebersicht.count({ where: { notePaErrechnet: { gte: 4.4, lte: 5.7 } } }),
      prisma.notenuebersicht.count({ where: { notePaErrechnet: { gte: 4.4, lte: 5.7 }, nkVisiert: false } }),
      prisma.notenuebersicht.count({ where: { notePaErrechnet: { gte: 5.8, lte: 6.0 } } }),
      prisma.notenuebersicht.count({ where: { notePaErrechnet: { gte: 5.8, lte: 6.0 }, nkVisiert: false } }),
    ]);

    const workingOn = await prisma.notenuebersicht.findMany({
      where: { nkVisiert: false, pexUserId: { not: null } },
      include: {
        kandidat: true,
        pexUser: { select: { id: true, email: true, role: true, createdAt: true } },
      },
    });

    const visiert = await prisma.notenuebersicht.findMany({
      where: { nkVisiert: true },
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
