// src/routes/lgas.js
// Returns the 16 Kwara State LGAs for form dropdowns.
//
// GET /api/lgas   Returns all LGAs sorted by name.

import { Router } from 'express';
import pool from '../db/pool.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT code, name FROM lgas ORDER BY name ASC');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
