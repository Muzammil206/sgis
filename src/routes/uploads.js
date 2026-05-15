// src/routes/uploads.js
// File upload endpoint.
//
// POST /api/uploads/:type    Upload a single file. type = plan | stamp | red_copy | document
//
// Returns: { url: "uploads/plans/1700000000000_abc.pdf", originalName, size, mimetype }
//
// The returned `url` value is stored directly in the database columns:
//   surveyor_lodgments.plan_scan_url
//   surveyor_lodgments.stamp_image_url
//   surveyor_lodgments.red_copy_scan_url
//
// Files are served as static assets by Express (configured in index.js).
// Access via: GET /uploads/plans/<filename>

import { Router } from 'express';
import { makeUploader, buildFilePath } from '../lib/upload.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const VALID_TYPES = new Set(['plan', 'stamp', 'red_copy', 'document']);

// ---------------------------------------------------------------------------
// POST /api/uploads/:type
// Authenticated. Accepts multipart/form-data with a single field named "file".
// ---------------------------------------------------------------------------
router.post('/:type', requireAuth, (req, res, next) => {
  const { type } = req.params;

  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({
      error: `Invalid upload type: "${type}". Must be one of: ${[...VALID_TYPES].join(', ')}.`,
    });
  }

  const upload = makeUploader(type);

  upload.single('file')(req, res, (err) => {
    if (err) {
      // Multer errors (file too large, wrong type, etc.)
      return res.status(err.status || 400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file received. Send a "file" field in multipart/form-data.' });
    }

    const filePath = buildFilePath(type, req.file.filename);

    res.status(201).json({
      url:          filePath,
      originalName: req.file.originalname,
      size:         req.file.size,
      mimetype:     req.file.mimetype,
    });
  });
});

export default router;
