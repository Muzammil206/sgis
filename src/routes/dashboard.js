// src/routes/dashboard.js
// Phase 8 — Dashboard & Reports
//
// GET /api/dashboard/stats        Overall system counts
// GET /api/dashboard/quarterly    Quarterly breakdown (filter: year)
// GET /api/dashboard/pending      All pending applications (no DB2 yet)
// GET /api/dashboard/flagged      All flagged/warned plans
// GET /api/dashboard/search?q=    Global search across all 3 databases

import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/dashboard/stats
// Top-level counts for dashboard cards.
// ---------------------------------------------------------------------------
router.get('/stats', requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                                 AS total_applications,
        COUNT(*) FILTER (WHERE status = 'pending')              AS pending,
        COUNT(*) FILTER (WHERE status = 'complete')             AS complete,
        COUNT(*) FILTER (WHERE status = 'flagged')              AS flagged,
        COUNT(*) FILTER (WHERE status = 'cancelled')            AS cancelled,
        (SELECT COUNT(*) FROM surveyor_lodgments)               AS total_lodgments,
        (SELECT COUNT(*) FROM client_lodgments)                 AS total_client_lodgments,
        (SELECT COUNT(*) FROM surveyors WHERE status = 'active') AS active_surveyors,
        (SELECT COALESCE(SUM(fee_paid), 0) FROM pillar_applications) AS total_fees_naira
      FROM pillar_applications
    `);

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/quarterly?year=2025
// Quarterly breakdown — uses the v_quarterly_stats view.
// ---------------------------------------------------------------------------
router.get('/quarterly', requireAuth, async (req, res, next) => {
  try {
    const year = req.query.year ? Number(req.query.year) : null;

    const { rows } = await pool.query(
      year
        ? 'SELECT * FROM v_quarterly_stats WHERE year = $1'
        : 'SELECT * FROM v_quarterly_stats',
      year ? [year] : []
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/pending
// All Pillar Applications with no Surveyor Lodgment yet.
// ---------------------------------------------------------------------------
router.get('/pending', requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM v_pending_applications');
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/flagged
// All flagged or warned plans with comparison check details.
// ---------------------------------------------------------------------------
router.get('/flagged', requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM v_flagged_plans');
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/search?q=<term>
// Global search across all 3 databases by plan number, surveyor name,
// surveyor reg, owner name, applicant name, CFC number, or pillar number.
// ---------------------------------------------------------------------------
router.get('/search', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const { rows } = await pool.query(
      `SELECT
         pa.plan_number,
         pa.status               AS application_status,
         pa.lga,
         pa.location,
         s.name                  AS surveyor_name,
         s.surveyor_reg          AS surveyor_reg_no,
         sl.owner_name,
         sl.certificate_no,
         cl.applicant_name,
         cl.cfc_no
       FROM pillar_applications pa
       JOIN surveyors s ON s.id = pa.surveyor_id
       LEFT JOIN surveyor_lodgments sl ON sl.plan_number = pa.plan_number
       LEFT JOIN client_lodgments   cl ON cl.plan_number = pa.plan_number
       WHERE
         pa.plan_number       ILIKE $1
         OR s.name            ILIKE $1
         OR s.surveyor_reg    ILIKE $1
         OR sl.owner_name     ILIKE $1
         OR cl.applicant_name ILIKE $1
         OR cl.cfc_no         ILIKE $1
         OR EXISTS (
           SELECT 1 FROM pillar_number_registry pnr
           WHERE pnr.plan_number = pa.plan_number
             AND pnr.pillar_number ILIKE $1
         )
       ORDER BY pa.created_at DESC
       LIMIT 25`,
      [`%${q}%`]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
