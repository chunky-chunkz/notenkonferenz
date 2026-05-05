import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';

// Ensure upload directories exist
const pdfDir = path.join(env.UPLOAD_DIR, 'pdf');
const zipDir = path.join(env.UPLOAD_DIR, 'zip');
fs.mkdirSync(pdfDir, { recursive: true });
fs.mkdirSync(zipDir, { recursive: true });

const pdfStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, pdfDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

export const uploadPdf = multer({
  storage: pdfStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

const zipStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, zipDir),
  filename: (_req, file, cb) => {
    cb(null, file.originalname); // Keep original name for ZIP uploads
  },
});

export const uploadZip = multer({
  storage: zipStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed') {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  },
});
