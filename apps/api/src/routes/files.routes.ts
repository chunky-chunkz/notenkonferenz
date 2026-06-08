import { Router, Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../config/database.js';
import { requireVex, effectiveRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { uploadZip } from '../middleware/upload.js';
import { pkorgDownloadPortfolioZip, pkorgGetMandantId } from '../services/pkorg/pkorgClient.js';

export const filesRouter = Router();
filesRouter.use(requireVex);

// ─── GET /api/files/portfolio/:kandidatId ────────────────────────────────────
filesRouter.get('/portfolio/:kandidatId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);

    const item = await prisma.notenuebersicht.findUnique({
      where: { kandidatId },
      include: { kandidat: true },
    });

    if (!item) {
      throw new AppError(404, 'not_found', 'Item not found');
    }

    // VEX: may only download portfolios within their active fachrichtung
    const role = effectiveRole(req);
    const fachrichtung = req.session.activePkorgFachrichtung;
    if (role === 'VEX') {
      if (!fachrichtung || !(item.fachrichtung ?? '').includes(fachrichtung)) {
        throw new AppError(403, 'forbidden', 'Not authorized to download this portfolio');
      }
    }

    const kandidat = item.kandidat;
    const filename = `Dossier_${kandidat?.nachname}_${kandidat?.vorname}.zip`;

    // 1. Serve from local file if already downloaded
    const dbPortfolio = await prisma.portfolio.findUnique({ where: { kandidatId } });
    if (dbPortfolio?.status === 'downloaded' && dbPortfolio.filePath) {
      const localPath = path.join(env.MEDIA_DIR, dbPortfolio.filePath);
      if (fs.existsSync(localPath)) {
        res.download(localPath, filename);
        return;
      }
    }

    // 2. Fallback: fetch from PKOrg live if session is available
    const cookies = req.session.pkorgCookies;
    if (cookies) {
      try {
        const nmandantid = await pkorgGetMandantId(cookies);
        const buffer = await pkorgDownloadPortfolioZip(cookies, nmandantid, kandidatId);

        const portfoliosDir = path.join(env.MEDIA_DIR, 'portfolios');
        fs.mkdirSync(portfoliosDir, { recursive: true });
        fs.writeFileSync(path.join(portfoliosDir, `${kandidatId}.zip`), buffer);

        await prisma.portfolio.upsert({
          where: { kandidatId },
          create: {
            kandidatId,
            filePath: `portfolios/${kandidatId}.zip`,
            status: 'downloaded',
            downloadedAt: new Date(),
          },
          update: {
            filePath: `portfolios/${kandidatId}.zip`,
            status: 'downloaded',
            downloadedAt: new Date(),
            error: null,
          },
        });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
        return;
      } catch {
        // Fall through to 404
      }
    }

    throw new AppError(404, 'file_not_found', 'Portfolio file not found. Please connect to PKOrg or download portfolios first.');
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/files/template/:kandidatId ─────────────────────────────────────
filesRouter.get('/template/:kandidatId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);

    const item = await prisma.notenuebersicht.findUnique({
      where: { kandidatId },
      include: { kandidat: true },
    });

    if (!item) {
      throw new AppError(404, 'not_found', 'Item not found');
    }

    const templatePath = path.join(env.MEDIA_DIR, 'vorlage_notenkonferenz_API.docx');
    if (!fs.existsSync(templatePath)) {
      throw new AppError(404, 'file_not_found', 'Template file not found');
    }

    const filename = `${item.kandidat?.nachname}_${item.kandidat?.vorname}-Korrekturen.docx`;
    res.download(templatePath, filename);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/files/anpassung/:anpassungId ───────────────────────────────────
filesRouter.get('/anpassung/:anpassungId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const anpassungId = parseInt(req.params.anpassungId, 10);

    const anpassung = await prisma.anpassung.findUnique({
      where: { id: anpassungId },
      include: {
        notenuebersicht: {
          include: { kandidat: true },
        },
      },
    });

    if (!anpassung || !anpassung.pdfPath) {
      throw new AppError(404, 'file_not_found', 'PDF not found');
    }

    if (!fs.existsSync(anpassung.pdfPath)) {
      throw new AppError(404, 'file_not_found', 'PDF file not found on server');
    }

    const kandidat = anpassung.notenuebersicht.kandidat;
    const filename = `${kandidat?.nachname}_${kandidat?.vorname}-Anpassung.pdf`;

    res.download(anpassung.pdfPath, filename);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/files/missing-portfolios ───────────────────────────────────────
filesRouter.get('/missing-portfolios', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidaten = await prisma.kandidat.findMany({
      include: { portfolio: true },
    });

    const missing = kandidaten.filter(
      (k) => k.portfolio?.status !== 'downloaded',
    );

    res.json({
      missing: missing.map((k) => ({
        id: k.id,
        vorname: k.vorname,
        nachname: k.nachname,
        portfolioStatus: k.portfolio?.status ?? 'pending',
      })),
      total: kandidaten.length,
      missingCount: missing.length,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/files/missing-portfolios ──────────────────────────────────────
filesRouter.post(
  '/missing-portfolios',
  uploadZip.array('zip_files', 50),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[];
      const saved = files?.map((f) => f.originalname) ?? [];

      // Move files to portfolios directory
      const portfoliosDir = path.join(env.MEDIA_DIR, 'portfolios');
      fs.mkdirSync(portfoliosDir, { recursive: true });

      for (const file of files ?? []) {
        const dest = path.join(portfoliosDir, file.originalname);
        fs.renameSync(file.path, dest);

        // Update DB record if filename matches pattern {kandidatId}.zip
        const match = file.originalname.match(/^(\d+)\.zip$/);
        if (match) {
          const kandidatId = parseInt(match[1], 10);
          const kandidat = await prisma.kandidat.findUnique({ where: { id: kandidatId } });
          if (kandidat) {
            await prisma.portfolio.upsert({
              where: { kandidatId },
              create: {
                kandidatId,
                filePath: `portfolios/${file.originalname}`,
                status: 'downloaded',
                downloadedAt: new Date(),
              },
              update: {
                filePath: `portfolios/${file.originalname}`,
                status: 'downloaded',
                downloadedAt: new Date(),
                error: null,
              },
            });
          }
        }
      }

      res.json({ status: 'ok', savedFiles: saved, count: saved.length });
    } catch (err) {
      next(err);
    }
  },
);
