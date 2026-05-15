// src/routes/surveyors.js
// Phase 2 — Surveyor Register API
//
// GET /api/surveyors/search?q=   Autocomplete (min 2 chars, active only)
// GET /api/surveyors/:id         Single lookup — auto-fill form fields after selection
// GET /api/surveyors             Paginated full register list
//
// All routes require authentication (requireAuth applied in index.js router mount).

import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/surveyors/search?q=<term>
// Searches: name, surveyor_reg, user_id, phone, email
// Returns up to 10 active surveyors. Requires min 2 chars.
// ---------------------------------------------------------------------------
router.get('/search', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const { rows } = await pool.query(
      `SELECT
         id,
         user_id       AS "userId",
         name,
         surveyor_reg  AS "surveyorReg",
         phone,
         email,
         firm_name     AS "firmName",
         firm_phone    AS "firmPhone",
         status
       FROM surveyors
       WHERE status = 'active'
         AND (
           name         ILIKE $1
           OR surveyor_reg ILIKE $1
           OR user_id      ILIKE $1
           OR phone        ILIKE $1
           OR email        ILIKE $1
         )
       ORDER BY
         CASE
           WHEN name         ILIKE $2 THEN 0
           WHEN surveyor_reg ILIKE $2 THEN 1
           WHEN user_id      ILIKE $2 THEN 2
           ELSE 3
         END,
         name ASC
       LIMIT 10`,
      [`%${q}%`, `${q}%`]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/surveyors/:id
// Returns a single surveyor by UUID — used to auto-fill form fields
// ---------------------------------------------------------------------------
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) return res.status(400).json({ error: 'Invalid ID format' });

    const { rows } = await pool.query(
      `SELECT
         id,
         user_id       AS "userId",
         name,
         surveyor_reg  AS "surveyorReg",
         phone,
         email,
         firm_name     AS "firmName",
         firm_phone    AS "firmPhone",
         status
       FROM surveyors
       WHERE id = $1`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Surveyor not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/surveyors?page=1&limit=20&status=active
// Paginated list — for the Surveyor Register admin page
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page   = Math.max(1, Number(req.query.page)  || 1);
    const limit  = Math.min(100, Number(req.query.limit) || 20);
    const status = req.query.status || null;
    const offset = (page - 1) * limit;

    const params = [];
    let where = '';
    if (status === 'active' || status === 'inactive') {
      where = 'WHERE status = $1';
      params.push(status);
    }

    const dataParams = [...params, limit, offset];
    const limitIdx   = params.length + 1;
    const offsetIdx  = params.length + 2;

    const [data, count] = await Promise.all([
      pool.query(
        `SELECT
           id,
           user_id       AS "userId",
           name,
           surveyor_reg  AS "surveyorReg",
           phone,
           email,
           firm_name     AS "firmName",
           firm_phone    AS "firmPhone",
           status,
           created_at    AS "createdAt"
         FROM surveyors
         ${where}
         ORDER BY name ASC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      ),
      pool.query(`SELECT COUNT(*) FROM surveyors ${where}`, params),
    ]);

    const total = Number(count.rows[0].count);
    res.json({
      data:       data.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
