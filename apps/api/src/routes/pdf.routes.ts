/**
 * PDF Processing Routes
 *
 * Provides PDF text extraction and listing from portfolio ZIP archives.
 * Mirrors Django views: extract_pdf_text_view + list_pdfs_in_zip
 */
import { Router, Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { prisma } from '../config/database.js';
import { requireStaff } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// pdf-parse has no @types, use dynamic import
let pdfParse: ((buffer: Buffer) => Promise<any>) | null = null;
(async () => {
  try {
    const mod: any = await import('pdf-parse');
    pdfParse = mod.default ?? mod;
  } catch {
    logger.warn('pdf-parse not installed – PDF text extraction will not work');
  }
})();

export const pdfRouter = Router();
pdfRouter.use(requireStaff);

// ─── GET /api/pdf/list/:kandidatId ───────────────────────────────────────────
// Lists all PDF files inside a candidate's portfolio ZIP
pdfRouter.get('/list/:kandidatId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);

    const kandidat = await prisma.kandidat.findUnique({ where: { id: kandidatId } });
    if (!kandidat) {
      throw new AppError(404, 'not_found', 'Kandidat nicht gefunden');
    }

    const zipPath = path.join(env.MEDIA_DIR, 'portfolios', `${kandidatId}.zip`);
    if (!fs.existsSync(zipPath)) {
      throw new AppError(404, 'file_not_found', `ZIP-Datei nicht gefunden für Kandidat ${kandidatId}`);
    }

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    const pdfFiles = entries
      .filter((entry: any) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.pdf'))
      .map((entry: any) => ({
        filename: entry.entryName,
        size_bytes: entry.header.size,
        size_kb: Math.round((entry.header.size / 1024) * 100) / 100,
        compressed_size: entry.header.compressedSize,
      }));

    res.json({
      status: 'success',
      kandidat: {
        id: kandidat.id,
        name: `${kandidat.vorname} ${kandidat.nachname}`,
      },
      pdf_count: pdfFiles.length,
      pdfs: pdfFiles,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/pdf/extract/:kandidatId ────────────────────────────────────────
// Extracts text from all PDFs inside a candidate's portfolio ZIP
pdfRouter.get('/extract/:kandidatId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kandidatId = parseInt(req.params.kandidatId, 10);

    const kandidat = await prisma.kandidat.findUnique({ where: { id: kandidatId } });
    if (!kandidat) {
      throw new AppError(404, 'not_found', 'Kandidat nicht gefunden');
    }

    // Permission check: must be assigned PEX or admin
    const notenuebersicht = await prisma.notenuebersicht.findUnique({
      where: { kandidatId },
    });
    if (
      notenuebersicht &&
      notenuebersicht.pexUserId !== req.session.userId &&
      req.session.userRole !== 'ADMIN'
    ) {
      throw new AppError(403, 'forbidden', 'Keine Berechtigung für diesen Kandidaten');
    }

    const zipPath = path.join(env.MEDIA_DIR, 'portfolios', `${kandidatId}.zip`);
    if (!fs.existsSync(zipPath)) {
      throw new AppError(404, 'file_not_found', `ZIP-Datei nicht gefunden für Kandidat ${kandidatId}`);
    }

    if (!pdfParse) {
      throw new AppError(500, 'dependency_missing', 'pdf-parse ist nicht installiert');
    }

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    const pdfEntries = entries.filter(
      (entry: any) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.pdf'),
    );

    if (pdfEntries.length === 0) {
      res.json({
        status: 'warning',
        message: 'Keine PDF-Dateien im ZIP-Archiv gefunden',
        kandidat: { id: kandidat.id, vorname: kandidat.vorname, nachname: kandidat.nachname },
        pdf_count: 0,
        pdfs: [],
      });
      return;
    }

    // Extract each PDF and parse text
    const pdfTexts: any[] = [];
    const tempDir = path.join(os.tmpdir(), `mcs_pdf_extract_${kandidatId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      for (const entry of pdfEntries) {
        try {
          // Extract PDF buffer from ZIP
          const pdfBuffer = entry.getData();

          // Parse PDF text
          const pdfData = await pdfParse(pdfBuffer);

          pdfTexts.push({
            filename: entry.entryName,
            text: pdfData.text,
            metadata: {
              filename: path.basename(entry.entryName),
              size_bytes: entry.header.size,
              size_mb: Math.round((entry.header.size / (1024 * 1024)) * 100) / 100,
              pages: pdfData.numpages,
              title: pdfData.info?.Title ?? '',
              author: pdfData.info?.Author ?? '',
              creator: pdfData.info?.Creator ?? '',
            },
            char_count: pdfData.text.length,
            word_count: pdfData.text.split(/\s+/).filter(Boolean).length,
          });
        } catch (err) {
          pdfTexts.push({
            filename: entry.entryName,
            error: (err as Error).message,
            status: 'extraction_failed',
          });
        }
      }
    } finally {
      // Cleanup temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

    res.json({
      status: 'success',
      kandidat: {
        id: kandidat.id,
        vorname: kandidat.vorname,
        nachname: kandidat.nachname,
      },
      pdf_count: pdfTexts.length,
      pdfs: pdfTexts,
    });
  } catch (err) {
    next(err);
  }
});
