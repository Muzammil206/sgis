// src/routes/lodgments.js
// Phase 4 — DB2: Surveyor Lodgments
//
// POST   /api/lodgments                            Create new Surveyor Lodgment
// GET    /api/lodgments                            List all (paginated)
// GET    /api/lodgments/:planNumber                Fetch single by plan number
// PATCH  /api/lodgments/:planNumber                Update document URLs / fields
// PATCH  /api/lodgments/:planNumber/certificate    Update certificate status

import { Router } from 'express';
import pool from '../db/pool.js';
import { genCertificateNo } from '../lib/refNumbers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { runAndStore } from './comparison.js';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/lodgments
// Creates a new Surveyor Lodgment (DB2).
// - plan_number must exist in DB1
// - Surveyor fields auto-filled from DB1 (sent by client after lookup)
// - Auto-generates Lodgement Certificate number
// - Triggers DB1 status flip to 'complete' (via DB trigger)
// - Auto-triggers comparison engine after save
// - enteredBy is taken from the authenticated token
// ---------------------------------------------------------------------------
router.post('/', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const {
      planNumber,
      // Surveyor (auto-filled from DB1, locked unless override)
      surveyorId,
      surveyorName,
      surveyorRegNo,
      firmName,
      // Land owner
      ownerName,
      // Pillars
      pillarPrefix,
      pillarsUsed,
      pillarNumbers,
      // Measurements
      actualAreaSqm,
      coordinateSystem,
      coordinateSystemType,  // new enum field
      utmNorthing,
      utmEasting,
      townshipNorthing,
      townshipEasting,
      wgs84Lat,              // new WGS84 fields
      wgs84Lng,
      scale,
      // Location (auto-filled from DB1, editable)
      location,
      lga,
      // Dates
      dateOfSurvey,
      dateSigned,
      dateLodged,
      // Quarter/year (auto-filled from DB1, editable)
      quarter,
      year,
      // Uploads — optional at creation; can be updated via PATCH
      planScanUrl,
      stampImageUrl,
      redCopyScanUrl,
      // Optional
      notes,
    } = req.body;

    // enteredBy comes from the authenticated token
    const enteredBy = req.user.id;

    // --- Validation ---
    const missing = [];
    if (!planNumber)        missing.push('planNumber');
    if (!surveyorId)        missing.push('surveyorId');
    if (!surveyorName)      missing.push('surveyorName');
    if (!surveyorRegNo)     missing.push('surveyorRegNo');
    if (!ownerName)         missing.push('ownerName');
    if (!pillarPrefix)      missing.push('pillarPrefix');
    if (!pillarsUsed)       missing.push('pillarsUsed');
    if (!pillarNumbers?.length) missing.push('pillarNumbers');
    if (!actualAreaSqm)     missing.push('actualAreaSqm');
    if (!scale)             missing.push('scale');
    // coordinate_system, utm_northing, utm_easting — optional (not all plans have UTM data)
    if (!location)          missing.push('location');
    if (!lga)               missing.push('lga');
    if (!dateOfSurvey)      missing.push('dateOfSurvey');
    if (!dateSigned)        missing.push('dateSigned');
    if (!dateLodged)        missing.push('dateLodged');
    if (!quarter)           missing.push('quarter');
    if (!year)              missing.push('year');

    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', fields: missing });
    }

    // Try to find a matching DB1 record — optional, not required
    const db1 = await pool.query(
      'SELECT id, pillar_numbers, pillars_requested, estimated_area_sqm FROM pillar_applications WHERE plan_number = $1',
      [planNumber]
    );

    const application   = db1.rows[0] || null;   // null = no DB1 record (standalone lodgment)
    const issuedPillars = application?.pillar_numbers || [];

    // If DB1 exists, validate pillar numbers are a subset of the issued list
    // If no DB1, skip validation — surveyor entered pillars freely
    if (application && pillarNumbers.length > 0) {
      const invalidPillars = pillarNumbers.filter((p) => !issuedPillars.includes(p));
      if (invalidPillars.length) {
        return res.status(400).json({
          error: `Pillar numbers not found in DB1 issued list: ${invalidPillars.join(', ')}`,
          invalidPillars,
          hint: 'Remove the invalid pillars or clear the DB1 link by leaving the plan number unmatched.',
        });
      }
    }

    // Auto-generate Lodgement Certificate number
    const certificateNo = await genCertificateNo();

    const { rows } = await pool.query(
      `INSERT INTO surveyor_lodgments (
         plan_number, application_id,
         surveyor_id, surveyor_name, surveyor_reg_no, firm_name,
         owner_name,
         pillar_prefix, pillars_used, pillar_numbers,
         actual_area_sqm, coordinate_system, coordinate_system_type,
         utm_northing, utm_easting,
         township_northing, township_easting,
         wgs84_lat, wgs84_lng,
         scale,
         location, lga,
         date_of_survey, date_signed, date_lodged,
         quarter, year,
         plan_scan_url, stamp_image_url, red_copy_scan_url,
         certificate_no, certificate_status,
         notes, entered_by
       ) VALUES (
         $1,$2,
         $3,$4,$5,$6,
         $7,
         $8,$9,$10,
         $11,$12,$13,
         $14,$15,
         $16,$17,
         $18,$19,
         $20,
         $21,$22,
         $23,$24,$25,
         $26,$27,
         $28,$29,$30,
         $31,'draft',
         $32,$33
       )
       RETURNING *,
         CASE WHEN geom IS NOT NULL
           THEN ST_AsGeoJSON(geom::geometry)::jsonb
           ELSE NULL
         END AS geom_json`,
      [
        planNumber, application?.id || null,
        surveyorId, surveyorName, surveyorRegNo, firmName || null,
        ownerName,
        pillarPrefix, pillarsUsed, pillarNumbers,
        actualAreaSqm, coordinateSystem || null, coordinateSystemType || null,
        utmNorthing || null, utmEasting || null,
        townshipNorthing || null, townshipEasting || null,
        wgs84Lat || null, wgs84Lng || null,
        scale,
        location, lga,
        dateOfSurvey, dateSigned, dateLodged,
        quarter, year,
        planScanUrl || null, stampImageUrl || null, redCopyScanUrl || null,
        certificateNo,
        notes || null, enteredBy,
      ]
    );

    const lodgment = rows[0];

    // Auto-trigger comparison engine — runs in background, does not block response
    runAndStore(planNumber, null).catch((err) =>
      console.error(`[Comparison] Auto-run failed for ${planNumber}:`, err.message)
    );

    res.status(201).json(lodgment);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'surveyor_lodgments_plan_number_key') {
      return res.status(409).json({
        error: `A Surveyor Lodgment for plan ${req.body.planNumber} already exists`,
      });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/lodgments?page=1&limit=20&certStatus=draft&year=2025&quarter=Q1&q=
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page      = Math.max(1, Number(req.query.page)   || 1);
    const limit     = Math.min(100, Number(req.query.limit) || 20);
    const offset    = (page - 1) * limit;
    const { certStatus, year, quarter, q } = req.query;

    const conditions = [];
    const params     = [];
    let   pi         = 1;

    if (certStatus) { conditions.push(`sl.certificate_status = $${pi++}`); params.push(certStatus); }
    if (year)       { conditions.push(`sl.year = $${pi++}`);               params.push(Number(year)); }
    if (quarter)    { conditions.push(`sl.quarter = $${pi++}`);            params.push(quarter); }
    if (q) {
      conditions.push(
        `(sl.plan_number ILIKE $${pi} OR sl.owner_name ILIKE $${pi} OR sl.surveyor_name ILIKE $${pi})`
      );
      params.push(`%${q}%`); pi++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      pool.query(
        `SELECT
           sl.id, sl.plan_number, sl.owner_name, sl.surveyor_name, sl.surveyor_reg_no,
           sl.actual_area_sqm, sl.pillars_used, sl.date_lodged,
           sl.certificate_no, sl.certificate_status, sl.quarter, sl.year,
           sl.location, sl.lga, sl.created_at
         FROM surveyor_lodgments sl
         ${where}
         ORDER BY sl.created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM surveyor_lodgments sl ${where}`, params),
    ]);

    const total = Number(count.rows[0].count);
    res.json({ data: data.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/lodgments/:planNumber
// ---------------------------------------------------------------------------
router.get('/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    // Get lodgment + linked DB1 if it exists
    const { rows } = await pool.query(
      `SELECT
         sl.*,
         -- GeoJSON for map display
         CASE WHEN sl.geom IS NOT NULL
           THEN ST_AsGeoJSON(sl.geom::geometry)::jsonb
           ELSE NULL
         END AS geom_json,
         -- DB1 data (NULL for standalone lodgments)
         pa.id                  AS pa_id,
         pa.date_applied        AS pa_date_applied,
         pa.estimated_area_sqm  AS pa_estimated_area_sqm,
         pa.pillars_requested   AS pa_pillars_requested,
         pa.land_use_type       AS pa_land_use_type,
         pa.lga                 AS pa_lga,
         pa.status              AS pa_status,
         pa.fee_paid            AS pa_fee_paid,
         pa.receipt_number      AS pa_receipt_number,
         pa.geom                AS pa_geom,
         CASE WHEN pa.geom IS NOT NULL
           THEN ST_AsGeoJSON(pa.geom::geometry)::jsonb
           ELSE NULL
         END AS pa_geom_json
       FROM surveyor_lodgments sl
       LEFT JOIN pillar_applications pa ON pa.plan_number = sl.plan_number
       WHERE sl.plan_number = $1`,
      [planNumber]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `No lodgment found for plan ${planNumber}` });
    }

    const row = rows[0];

    // Shape the response cleanly
    res.json({
      ...row,
      // DB1 context (null for standalone)
      application: row.pa_id ? {
        id:               row.pa_id,
        date_applied:     row.pa_date_applied,
        estimated_area_sqm: row.pa_estimated_area_sqm,
        pillars_requested:  row.pa_pillars_requested,
        land_use_type:    row.pa_land_use_type,
        lga:              row.pa_lga,
        status:           row.pa_status,
        fee_paid:         row.pa_fee_paid,
        receipt_number:   row.pa_receipt_number,
        geom_json:        row.pa_geom_json,
      } : null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/lodgments/:planNumber
// Update document URLs and editable fields after initial entry.
// Staff can update: planScanUrl, stampImageUrl, redCopyScanUrl, notes,
//                   ownerName, coordinateSystem, utmNorthing, utmEasting,
//                   townshipNorthing, townshipEasting, scale,
//                   location, lga, dateOfSurvey, dateSigned, dateLodged,
//                   quarter, year
// ---------------------------------------------------------------------------
router.patch('/:planNumber', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { planNumber } = req.params;
    const {
      planScanUrl,
      stampImageUrl,
      redCopyScanUrl,
      ownerName,
      coordinateSystem,
      utmNorthing,
      utmEasting,
      townshipNorthing,
      townshipEasting,
      scale,
      location,
      lga,
      dateOfSurvey,
      dateSigned,
      dateLodged,
      quarter,
      year,
      notes,
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE surveyor_lodgments SET
         plan_scan_url      = COALESCE($1,  plan_scan_url),
         stamp_image_url    = COALESCE($2,  stamp_image_url),
         red_copy_scan_url  = COALESCE($3,  red_copy_scan_url),
         owner_name         = COALESCE($4,  owner_name),
         coordinate_system  = COALESCE($5,  coordinate_system),
         utm_northing       = COALESCE($6,  utm_northing),
         utm_easting        = COALESCE($7,  utm_easting),
         township_northing  = COALESCE($8,  township_northing),
         township_easting   = COALESCE($9,  township_easting),
         scale              = COALESCE($10, scale),
         location           = COALESCE($11, location),
         lga                = COALESCE($12, lga),
         date_of_survey     = COALESCE($13, date_of_survey),
         date_signed        = COALESCE($14, date_signed),
         date_lodged        = COALESCE($15, date_lodged),
         quarter            = COALESCE($16, quarter),
         year               = COALESCE($17, year),
         notes              = COALESCE($18, notes),
         updated_at         = NOW()
       WHERE plan_number = $19
       RETURNING *`,
      [
        planScanUrl      ?? null,
        stampImageUrl    ?? null,
        redCopyScanUrl   ?? null,
        ownerName        ?? null,
        coordinateSystem ?? null,
        utmNorthing      ?? null,
        utmEasting       ?? null,
        townshipNorthing ?? null,
        townshipEasting  ?? null,
        scale            ?? null,
        location         ?? null,
        lga              ?? null,
        dateOfSurvey     ?? null,
        dateSigned       ?? null,
        dateLodged       ?? null,
        quarter          ?? null,
        year             ?? null,
        notes            ?? null,
        planNumber,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: `Plan ${planNumber} not found` });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/lodgments/:planNumber/certificate
// Update certificate status: draft → reviewed → issued
// Only admin or staff can review; only admin can issue.
// ---------------------------------------------------------------------------
router.patch('/:planNumber/certificate', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { planNumber }                  = req.params;
    const { certificateStatus }           = req.body;

    const allowed = ['draft', 'reviewed', 'issued'];
    if (!certificateStatus || !allowed.includes(certificateStatus)) {
      return res.status(400).json({ error: `certificateStatus must be one of: ${allowed.join(', ')}` });
    }

    // Only admin can move to 'issued'
    if (certificateStatus === 'issued' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admin can mark a certificate as issued.' });
    }

    const issuedBy = certificateStatus === 'issued' ? req.user.id : null;
    const issuedAt = certificateStatus === 'issued' ? new Date().toISOString() : null;

    const { rows } = await pool.query(
      `UPDATE surveyor_lodgments
       SET
         certificate_status    = $1,
         certificate_issued_by = CASE WHEN $1 = 'issued' THEN $2::uuid    ELSE certificate_issued_by END,
         certificate_issued_at = CASE WHEN $1 = 'issued' THEN $3::timestamptz ELSE certificate_issued_at END,
         updated_at            = NOW()
       WHERE plan_number = $4
       RETURNING id, plan_number, certificate_no, certificate_status,
                 certificate_issued_at, certificate_issued_by`,
      [certificateStatus, issuedBy, issuedAt, planNumber]
    );

    if (!rows.length) return res.status(404).json({ error: `Plan ${planNumber} not found` });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;