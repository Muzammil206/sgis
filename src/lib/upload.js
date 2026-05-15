// src/lib/upload.js
// Multer configuration for local disk file uploads.
// Files are saved to UPLOAD_DIR (from .env, default: uploads/).
// Organised into sub-folders by type: plans, stamps, red_copies, documents.
//
// The full server file path is stored in the DB (e.g. uploads/plans/file.pdf).
// The frontend requests files via GET /api/uploads/:folder/:filename — served
// as static files by Express (configured in index.js).

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const UPLOAD_DIR      = process.env.UPLOAD_DIR      || 'uploads';
const MAX_SIZE_BYTES  = Number(process.env.UPLOAD_MAX_SIZE_BYTES) || 20 * 1024 * 1024; // 20MB

// Sub-folders
const FOLDERS = {
  plan:       'plans',
  stamp:      'stamps',
  red_copy:   'red_copies',
  document:   'documents',
};

// Ensure all upload sub-dirs exist on startup
Object.values(FOLDERS).forEach((folder) => {
  const dir = path.join(UPLOAD_DIR, folder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[Upload] Created directory: ${dir}`);
  }
});

// Allowed MIME types
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
]);

/**
 * Returns a multer instance configured to save to the given sub-folder.
 * @param {'plan'|'stamp'|'red_copy'|'document'} folderKey
 */
export function makeUploader(folderKey) {
  const subFolder = FOLDERS[folderKey];
  if (!subFolder) throw new Error(`Unknown upload folder key: ${folderKey}`);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, path.join(UPLOAD_DIR, subFolder));
    },
    filename: (_req, file, cb) => {
      // Unique name: timestamp + random hex + original extension
      const ext  = path.extname(file.originalname).toLowerCase() || '.bin';
      const rand = crypto.randomBytes(8).toString('hex');
      cb(null, `${Date.now()}_${rand}${ext}`);
    },
  });

  const fileFilter = (_req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        Object.assign(new Error(`File type not allowed: ${file.mimetype}. Allowed: PDF, JPEG, PNG, WEBP, TIFF.`), {
          status: 400,
        })
      );
    }
  };

  return multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE_BYTES } });
}

/**
 * buildFilePath(folderKey, filename)
 * Returns the relative path that gets stored in the database.
 * e.g. "uploads/plans/1700000000000_abc12345.pdf"
 */
export function buildFilePath(folderKey, filename) {
  return path.join(UPLOAD_DIR, FOLDERS[folderKey], filename).replace(/\\/g, '/');
}

export { UPLOAD_DIR };
