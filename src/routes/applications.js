// src/routes/applications.js
// Phase 3 — DB1: Pillar Applications
//
// POST   /api/applications              Create new Pillar Application
// GET    /api/applications              List all (paginated, filterable)
// GET    /api/applications/:planNumber  Fetch single by plan number
// PATCH  /api/applications/:planNumber  Update status/notes (staff only)

import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Plan number format validator: KW/digits/digits/year  e.g. KW/3465/47/2024
const PLAN_NUMBER_REGEX = /^KW\/\d+\/\d+\/\d{4}$/;

// ---------------------------------------------------------------------------
// POST /api/applications
// Creates a new Pillar Application (DB1).
// Surveyor fields are auto-filled by the client from the surveyor register.
// Pillar number uniqueness is enforced by DB trigger.
// enteredBy is taken from the authenticated user's token — not from the request body.
// ---------------------------------------------------------------------------
router.post('/', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const {
      // Surveyor (selected from register)
      surveyorId,
      surveyorName,
      surveyorRegNo,
      firmName,
      firmPhone,
      // Plan
      planNumber,
      dateApplied,
      // Pillars
      pillarPrefix,
      pillarsRequested,
      pillarNumbers,
      // Land
      location,
      lga,
      landUseType,
      estimatedAreaSqm,
      // Quarter & fee
      quarter,
      year,
      feePaid,
      receiptNumber,
      paymentDate,
      // Optional
      notes,
    } = req.body;

    // enteredBy comes from the authenticated token — never from the request body
    const enteredBy = req.user.id;

    // --- Validation ---
    const missing = [];
    if (!surveyorId)                            missing.push('surveyorId');
    if (!surveyorName)                          missing.push('surveyorName');
    if (!surveyorRegNo)                         missing.push('surveyorRegNo');
    if (!planNumber)                            missing.push('planNumber');
    if (!dateApplied)                           missing.push('dateApplied');
    if (!pillarPrefix)                          missing.push('pillarPrefix');
    if (!pillarsRequested)                      missing.push('pillarsRequested');
    if (!pillarNumbers?.length)                 missing.push('pillarNumbers');
    if (!location)                              missing.push('location');
    if (!lga)                                   missing.push('lga');
    if (!landUseType)                           missing.push('landUseType');
    if (!estimatedAreaSqm)                      missing.push('estimatedAreaSqm');
    if (!quarter)                               missing.push('quarter');
    if (!year)                                  missing.push('year');
    if (feePaid === undefined || feePaid === null) missing.push('feePaid');
    if (!receiptNumber)                         missing.push('receiptNumber');
    if (!paymentDate)                           missing.push('paymentDate');

    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', fields: missing });
    }

    if (!PLAN_NUMBER_REGEX.test(planNumber)) {
      return res.status(400).json({
        error: 'Invalid plan number format. Expected: KW/{serial}/{regNo}/{year} e.g. KW/3465/47/2024',
      });
    }

    if (!Array.isArray(pillarNumbers) || pillarNumbers.length !== Number(pillarsRequested)) {
      return res.status(400).json({
        error: `pillarNumbers array length (${pillarNumbers?.length}) must equal pillarsRequested (${pillarsRequested})`,
      });
    }

    // Check surveyor is active
    const survCheck = await pool.query(
      'SELECT id, status FROM surveyors WHERE id = $1',
      [surveyorId]
    );
    if (!survCheck.rows.length) {
      return res.status(400).json({ error: 'Surveyor not found in register' });
    }
    if (survCheck.rows[0].status !== 'active') {
      return res.status(400).json({ error: 'Surveyor is inactive — cannot create application' });
    }

    // Insert — pillar uniqueness enforced by DB trigger fn_register_pillar_numbers
    const { rows } = await pool.query(
      `INSERT INTO pillar_applications (
         surveyor_id, surveyor_name, surveyor_reg_no, firm_name, firm_phone,
         plan_number, date_applied,
         pillar_prefix, pillars_requested, pillar_numbers,
         location, lga, land_use_type, estimated_area_sqm,
         quarter, year, fee_paid, receipt_number, payment_date,
         notes, entered_by
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,
         $8,$9,$10,
         $11,$12,$13,$14,
         $15,$16,$17,$18,$19,
         $20,$21
       )
       RETURNING *`,
      [
        surveyorId, surveyorName, surveyorRegNo, firmName || null, firmPhone || null,
        planNumber, dateApplied,
        pillarPrefix, pillarsRequested, pillarNumbers,
        location, lga, landUseType, estimatedAreaSqm,
        quarter, year, feePaid, receiptNumber, paymentDate,
        notes || null, enteredBy,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    // Trap pillar uniqueness violation from DB trigger
    if (err.message?.includes('already registered')) {
      return res.status(409).json({ error: err.message });
    }
    // Trap plan number duplicate (unique constraint)
    if (err.code === '23505' && err.constraint === 'pillar_applications_plan_number_key') {
      return res.status(409).json({ error: `Plan number ${req.body.planNumber} already exists` });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/applications
// Paginated list with optional filters: status, lga, year, quarter, q (search)
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page    = Math.max(1, Number(req.query.page)   || 1);
    const limit   = Math.min(100, Number(req.query.limit) || 20);
    const offset  = (page - 1) * limit;
    const { status, lga, year, quarter, q } = req.query;

    const conditions = [];
    const params     = [];
    let   pi         = 1;

    if (status)  { conditions.push(`pa.status = $${pi++}`);         params.push(status); }
    if (lga)     { conditions.push(`pa.lga = $${pi++}`);            params.push(lga); }
    if (year)    { conditions.push(`pa.year = $${pi++}`);           params.push(Number(year)); }
    if (quarter) { conditions.push(`pa.quarter = $${pi++}`);        params.push(quarter); }
    if (q) {
      conditions.push(`(pa.plan_number ILIKE $${pi} OR s.name ILIKE $${pi} OR s.surveyor_reg ILIKE $${pi})`);
      params.push(`%${q}%`); pi++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      pool.query(
        `SELECT
           pa.id, pa.plan_number, pa.status, pa.date_applied, pa.quarter, pa.year,
           pa.lga, pa.location, pa.land_use_type, pa.estimated_area_sqm,
           pa.pillars_requested, pa.fee_paid, pa.created_at,
           s.name AS surveyor_name, s.surveyor_reg AS surveyor_reg_no, s.phone AS surveyor_phone
         FROM pillar_applications pa
         JOIN surveyors s ON s.id = pa.surveyor_id
         ${where}
         ORDER BY pa.created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*)
         FROM pillar_applications pa
         JOIN surveyors s ON s.id = pa.surveyor_id
         ${where}`,
        params
      ),
    ]);

    const total = Number(count.rows[0].count);
    res.json({ data: data.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/applications/:planNumber
// Fetch a single Pillar Application with full surveyor detail.
// Also returns DB2 and DB3 records if they exist (for context).
// ---------------------------------------------------------------------------
router.get('/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    const { rows } = await pool.query(
      `SELECT
         pa.*,
         s.user_id    AS "surveyorUserId",
         s.email      AS "surveyorEmail",
         s.firm_name  AS "surveyorFirmName",
         s.firm_phone AS "surveyorFirmPhone"
       FROM pillar_applications pa
       JOIN surveyors s ON s.id = pa.surveyor_id
       WHERE pa.plan_number = $1`,
      [planNumber]
    );

    if (!rows.length) return res.status(404).json({ error: `Plan number ${planNumber} not found` });

    const application = rows[0];

    // Attach DB2 if exists
    const db2 = await pool.query(
      'SELECT * FROM surveyor_lodgments WHERE plan_number = $1',
      [planNumber]
    );

    // Attach DB3 if exists
    const db3 = await pool.query(
      'SELECT * FROM client_lodgments WHERE plan_number = $1',
      [planNumber]
    );

    res.json({
      application,
      surveyorLodgment: db2.rows[0] || null,
      clientLodgment:   db3.rows[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/applications/:planNumber
// Staff: update status or notes. Admin can cancel.
// ---------------------------------------------------------------------------
router.patch('/:planNumber', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { planNumber } = req.params;
    const { status, notes } = req.body;

    const allowed = ['pending', 'complete', 'flagged', 'cancelled'];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${allowed.join(', ')}` });
    }

    const { rows } = await pool.query(
      `UPDATE pillar_applications
       SET
         status     = COALESCE($1, status),
         notes      = COALESCE($2, notes),
         updated_at = NOW()
       WHERE plan_number = $3
       RETURNING *`,
      [status || null, notes || null, planNumber]
    );

    if (!rows.length) return res.status(404).json({ error: `Plan number ${planNumber} not found` });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
