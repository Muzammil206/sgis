// src/routes/formIntake.js  (Option C — no Vercel)
//
// POST /api/form-intake        — receives approved submissions directly from Apps Script
//                                via Cloudflare Tunnel. Authenticated by X-API-Key header.
// GET  /api/form-intake/staging — staff view of staging entries (JWT auth)

import { Router }                   from 'express';
import pool                         from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// API key middleware
// Apps Script sends X-API-Key header. Must match SGIS_API_KEY in .env.
// This replaces the old X-Internal-Key (Vercel) approach.
// ---------------------------------------------------------------------------

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.SGIS_API_KEY) {
    console.warn('[form-intake] Rejected — invalid or missing X-API-Key from:', req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// "First Quarter (January - March)" → "Q1"
function normaliseQuarter(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes('first')  || lower.includes('jan')) return 'Q1';
  if (lower.includes('second') || lower.includes('apr')) return 'Q2';
  if (lower.includes('third')  || lower.includes('jul')) return 'Q3';
  if (lower.includes('fourth') || lower.includes('oct')) return 'Q4';
  const match = raw.match(/Q[1-4]/i);
  return match ? match[0].toUpperCase() : null;
}

// "SURV. BODUNDE A. FRANCIS (4830) (BF)" → "4830"
function extractSurveyorReg(surveyorRaw) {
  if (!surveyorRaw) return null;
  const match = surveyorRaw.match(/\((\d+)\)/);
  return match ? match[1] : null;
}

// series="L", start=3366, end=3369 → ["L3366","L3367","L3368","L3369"]
function generatePillarNumbers(series, start, end) {
  if (!series || start == null || end == null) return [];
  const numbers = [];
  for (let i = start; i <= end; i++) numbers.push(`${series}${i}`);
  return numbers;
}

// "Regular" → 'residential' (default fallback)
function mapLandUse(surveyRequest) {
  const map = {
    residential:   'residential',
    commercial:    'commercial',
    agricultural:  'agricultural',
    institutional: 'institutional',
    industrial:    'industrial',
  };
  return map[(surveyRequest || '').toLowerCase()] || 'residential';
}

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

const REQUIRED_FIELDS = [
  'planNumber', 'surveyorRaw', 'year', 'lga',
  'locationAddress', 'numberOfPillars', 'pillarSeries', 'pillarStart', 'pillarEnd',
];

// ---------------------------------------------------------------------------
// POST /api/form-intake
// ---------------------------------------------------------------------------

router.post('/', requireApiKey, async (req, res, next) => {
  const requestId = `req_${Date.now().toString(36)}`;
  const client    = await pool.connect();

  try {
    const body = req.body;

    // Validate required fields
    const missing = REQUIRED_FIELDS.filter(f => {
      const v = body[f];
      return v === undefined || v === null || v === '';
    });
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', missing });
    }

    console.log(`[form-intake] ${requestId} | ${body.planNumber} | received`);

    await client.query('BEGIN');

    // ── Step 1: Upsert into staging (idempotent) ──────────────────────────
    // If Apps Script retries after a network blip, ON CONFLICT just updates
    // the raw_payload and timestamp — no duplicate, no error.

    const stagingResult = await client.query(
      `INSERT INTO form_intake_staging (
         plan_number, timestamp_submitted, surveyor_raw,
         year, quarter_raw, location_address, lga, survey_request,
         amount_surcon, amount_mds, date_of_payment,
         number_of_pillars, pillar_series, pillar_start, pillar_end,
         survey_plan_url, nis_clearance_url, surcon_payment_url,
         dwg_autocad_url, mds_payment_url,
         resident_status, sheet_status, raw_payload
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,$22,$23
       )
       ON CONFLICT (plan_number) DO UPDATE SET
         sheet_status = EXCLUDED.sheet_status,
         raw_payload  = EXCLUDED.raw_payload,
         received_at  = NOW()
       RETURNING id, processing_status, promoted_application_id`,
      [
        body.planNumber,
        body.timestampSubmitted    || null,
        body.surveyorRaw,
        body.year,
        body.quarterRaw            || null,
        body.locationAddress,
        body.lga,
        body.surveyRequest         || null,
        body.amountSurcon          || null,
        body.amountMds             || null,
        body.dateOfPayment         || null,
        body.numberOfPillars,
        body.pillarSeries,
        body.pillarStart,
        body.pillarEnd,
        body.surveyPlanUrl         || null,
        body.nisClearanceUrl       || null,
        body.surconPaymentUrl      || null,
        body.dwgAutocadUrl         || null,
        body.mdsPaymentUrl         || null,
        body.residentStatus        || null,
        'Approved',
        JSON.stringify(body),
      ]
    );

    const staging   = stagingResult.rows[0];
    const stagingId = staging.id;

    // Already promoted → return existing record (idempotent)
    if (staging.processing_status === 'promoted' && staging.promoted_application_id) {
      await client.query('ROLLBACK');
      const { rows } = await pool.query(
        'SELECT * FROM pillar_applications WHERE id = $1',
        [staging.promoted_application_id]
      );
      console.log(`[form-intake] ${requestId} | ${body.planNumber} | already promoted`);
      return res.status(200).json({ message: 'Already processed', application: rows[0] });
    }

    // ── Step 2: Resolve surveyor ──────────────────────────────────────────

    const surveyorReg = extractSurveyorReg(body.surveyorRaw);
    if (!surveyorReg) {
      await markFailed(client, stagingId,
        `Cannot extract reg no. from: "${body.surveyorRaw}"`);
      await client.query('COMMIT');
      return res.status(422).json({
        error: `Cannot extract SURCON reg number from: "${body.surveyorRaw}". `
             + `Expected format: "SURV. NAME (RegNo) (Initials)"`,
      });
    }

    const { rows: surveyorRows } = await client.query(
      `SELECT id, name, surveyor_reg, firm_name, firm_phone, status
       FROM surveyors WHERE surveyor_reg = $1`,
      [surveyorReg]
    );

    if (!surveyorRows.length) {
      await markFailed(client, stagingId, `Surveyor reg ${surveyorReg} not found`);
      await client.query('COMMIT');
      return res.status(422).json({
        error: `Surveyor with SURCON reg "${surveyorReg}" not found in SGIS register.`,
      });
    }

    const surveyor = surveyorRows[0];

    if (surveyor.status !== 'active') {
      await markFailed(client, stagingId, `Surveyor ${surveyorReg} is inactive`);
      await client.query('COMMIT');
      return res.status(422).json({
        error: `Surveyor ${surveyor.name} (${surveyorReg}) is inactive.`,
      });
    }

    // ── Step 3: Derive all values ─────────────────────────────────────────

    const quarter = normaliseQuarter(body.quarterRaw);
    if (!quarter) {
      await markFailed(client, stagingId, `Cannot parse quarter: "${body.quarterRaw}"`);
      await client.query('COMMIT');
      return res.status(422).json({
        error: `Cannot determine quarter from: "${body.quarterRaw}"`,
      });
    }

    const pillarNumbers = generatePillarNumbers(
      body.pillarSeries, body.pillarStart, body.pillarEnd
    );

    if (!pillarNumbers.length) {
      await markFailed(client, stagingId, 'Could not generate pillar numbers');
      await client.query('COMMIT');
      return res.status(422).json({
        error: `Cannot generate pillar numbers from series="${body.pillarSeries}" `
             + `start=${body.pillarStart} end=${body.pillarEnd}`,
      });
    }

    if (pillarNumbers.length !== Number(body.numberOfPillars)) {
      console.warn(
        `[form-intake] ${requestId} | pillar count mismatch: `
        + `form=${body.numberOfPillars} generated=${pillarNumbers.length}. Using generated.`
      );
    }

    // ── Step 4: Insert into pillar_applications ───────────────────────────
    // DB trigger fn_register_pillar_numbers runs automatically and registers
    // each pillar in pillar_number_registry — global uniqueness enforced.

    const { rows: appRows } = await client.query(
      `INSERT INTO pillar_applications (
         surveyor_id,    surveyor_name,    surveyor_reg_no,
         firm_name,      firm_phone,
         plan_number,    date_applied,
         pillar_prefix,  pillars_requested, pillar_numbers,
         location,       lga,               land_use_type,  estimated_area_sqm,
         quarter,        year,
         fee_paid,       receipt_number,    payment_date,
         notes,          entered_by,
         source,         intake_staging_id,
         survey_plan_url, nis_clearance_url, surcon_payment_url,
         dwg_autocad_url, mds_payment_url,
         survey_request_type, resident_status
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
       )
       RETURNING *`,
      [
        surveyor.id,
        surveyor.name,
        surveyor.surveyor_reg,
        surveyor.firm_name  || null,
        surveyor.firm_phone || null,

        body.planNumber,
        body.dateOfPayment  || new Date().toISOString().split('T')[0],

        body.pillarSeries,
        pillarNumbers.length,
        pillarNumbers,

        body.locationAddress,
        body.lga,
        mapLandUse(body.surveyRequest),
        0,

        quarter,
        body.year,

        parseFloat(body.amountSurcon) || 0,
        `FORM-${body.planNumber}`,
        body.dateOfPayment || null,

        null,
        SYSTEM_USER_ID,

        'google_form',
        stagingId,

        body.surveyPlanUrl    || null,
        body.nisClearanceUrl  || null,
        body.surconPaymentUrl || null,
        body.dwgAutocadUrl    || null,
        body.mdsPaymentUrl    || null,

        body.surveyRequest  || null,
        body.residentStatus || null,
      ]
    );

    const application = appRows[0];

    // ── Step 5: Mark staging row as promoted ──────────────────────────────

    await client.query(
      `UPDATE form_intake_staging
       SET processing_status       = 'promoted',
           promoted_application_id = $1,
           processed_at            = NOW()
       WHERE id = $2`,
      [application.id, stagingId]
    );

    await client.query('COMMIT');

    console.log(
      `[form-intake] ${requestId} | ${body.planNumber} | `
      + `promoted → ${application.id} | pillars: ${pillarNumbers.join(', ')}`
    );

    return res.status(201).json({
      message:      'Application created successfully',
      application,
      pillarNumbers,
      stagingId,
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    if (err.message?.includes('already registered')) {
      return res.status(409).json({
        error: `Pillar conflict: ${err.message}`,
      });
    }
    if (err.code === '23505' && err.constraint === 'pillar_applications_plan_number_key') {
      return res.status(409).json({
        error: `Plan number ${req.body?.planNumber} already exists.`,
      });
    }

    console.error(`[form-intake] ${requestId} | unhandled:`, err.message);
    next(err);

  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// GET /api/form-intake/staging — staff monitor view (JWT auth)
// ---------------------------------------------------------------------------

router.get('/staging', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const page   = Math.max(1, Number(req.query.page)  || 1);
    const limit  = Math.min(100, Number(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const { status } = req.query;

    const params = [];
    let   where  = '';
    if (status) { where = 'WHERE processing_status = $1'; params.push(status); }

    const { rows } = await pool.query(
      `SELECT
         id, plan_number, surveyor_raw, lga,
         number_of_pillars, pillar_series, pillar_start, pillar_end,
         processing_status, processing_error,
         promoted_application_id, received_at, processed_at
       FROM form_intake_staging
       ${where}
       ORDER BY received_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ data: rows, page, limit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function markFailed(client, stagingId, errorMessage) {
  await client.query(
    `UPDATE form_intake_staging
     SET processing_status = 'failed',
         processing_error  = $1,
         processed_at      = NOW()
     WHERE id = $2`,
    [errorMessage, stagingId]
  );
}

export default router;