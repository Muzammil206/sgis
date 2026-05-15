// src/routes/clients.js
// Phase 5 — DB3: Client Lodgments
//
// POST   /api/clients              Create new Client Lodgment — entered by Records dept
// GET    /api/clients              List all (paginated)
// GET    /api/clients/:planNumber  Fetch single by plan number
// PATCH  /api/clients/:planNumber  Update fields (used by workflow stages)

import { Router } from 'express';
import pool from '../db/pool.js';
import { genCfcNo, genCirRefNo, genLodgementNo, genLandNo, genSurveyNo } from '../lib/refNumbers.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { runAndStore } from './comparison.js';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/clients
// Created by Records department (Stage 1) — they receive the physical CFC form,
// KW-IRS receipt, and survey plan, then enter everything into the system.
// Auto-generates all 5 reference numbers.
// Initialises the 6-stage workflow automatically.
// ---------------------------------------------------------------------------
router.post('/', requireAuth, requireRole('admin', 'staff', 'records'), async (req, res, next) => {
  try {
    const {
      // Core link
      planNumber,
      lodgedAt,

      // Applicant — from CFC form Section 1
      applicantTitle,
      applicantName,       // First name
      applicantMiddle,
      applicantSurname,
      applicantIsLegalOccupant,
      applicantPhone,
      applicantPhone2,
      applicantEmail,
      applicantIdType,
      applicantIdNo,

      // Applicant address
      applicantHouseNo,
      applicantStreet,
      applicantCommunity,
      applicantCity,
      applicantState,
      applicantAddressExtra,

      // Land parcel — from CFC form Section 2
      landSameAsAddress,
      landHouseNo,
      landStreet,
      landCity,
      landState,
      landDelineatedBy,    // 'survey_plan' or 'site_plan'
      surveyReason,        // 'status_only' | 'land_registration' | 'cofo'

      // Payment
      kwIrsReceiptNo,
      kwIrsPaymentDate,
      kwIrsAmount,
      kwIrsTrnId,

      // Whether submitted by the surveyor on behalf of client
      submittedBySurveyor,
      notes,
    } = req.body;

    // enteredBy from JWT
    const enteredBy = req.user.id;

    const missing = [];
    if (!planNumber)    missing.push('planNumber');
    if (!applicantName) missing.push('applicantName');
    if (!lodgedAt)      missing.push('lodgedAt');
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', fields: missing });
    }
    if (submittedBySurveyor === undefined)   missing.push('submittedBySurveyor');
    if (!lodgedAt)                           missing.push('lodgedAt');

    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', fields: missing });
    }

    // Try to find a matching DB1 record — optional, not required
    const db1 = await pool.query(
      'SELECT id FROM pillar_applications WHERE plan_number = $1',
      [planNumber]
    );
    const applicationId = db1.rows[0]?.id || null; // null = standalone / old record

    // Auto-generate all 5 reference numbers
    const [cfcNo, lodgementNo, landNo, surveyNo, refNo] = await Promise.all([
      genCfcNo(),
      genLodgementNo(),
      genLandNo(),
      genSurveyNo(),
      genCirRefNo(),
    ]);

    const { rows } = await pool.query(
      `INSERT INTO client_lodgments (
         plan_number, application_id,
         cfc_no, lodgement_no, land_no, survey_no, ref_no,
         -- Applicant
         applicant_name, applicant_title, applicant_middle, applicant_surname,
         applicant_is_legal_occupant, applicant_phone, applicant_phone2,
         applicant_email, applicant_id_type, applicant_id_no,
         -- Applicant address
         applicant_house_no, applicant_street, applicant_community,
         applicant_city, applicant_state, applicant_address_extra,
         -- Land parcel
         land_same_as_address, land_house_no, land_street,
         land_city, land_state, land_delineated_by, survey_reason,
         -- Payment
         kwirs_receipt_no, kwirs_payment_date, kwirs_amount, kwirs_trn_id,
         -- Meta
         submitted_by_surveyor, lodged_at, notes, entered_by
       ) VALUES (
         $1,$2,
         $3,$4,$5,$6,$7,
         $8,$9,$10,$11,
         $12,$13,$14,
         $15,$16,$17,
         $18,$19,$20,
         $21,$22,$23,
         $24,$25,$26,
         $27,$28,$29,$30,
         $31,$32,$33,$34,
         $35,$36,$37,$38
       )
       RETURNING *`,
      [
        planNumber, applicationId,
        cfcNo, lodgementNo, landNo, surveyNo, refNo,
        // Applicant
        applicantName, applicantTitle || null, applicantMiddle || null, applicantSurname || null,
        Boolean(applicantIsLegalOccupant), applicantPhone || null, applicantPhone2 || null,
        applicantEmail || null, applicantIdType || null, applicantIdNo || null,
        // Applicant address
        applicantHouseNo || null, applicantStreet || null, applicantCommunity || null,
        applicantCity || null, applicantState || 'Kwara State', applicantAddressExtra || null,
        // Land parcel
        Boolean(landSameAsAddress), landHouseNo || null, landStreet || null,
        landCity || null, landState || 'Kwara State', landDelineatedBy || null, surveyReason || null,
        // Payment
        kwIrsReceiptNo || null, kwIrsPaymentDate || null,
        kwIrsAmount ? Number(kwIrsAmount) : null, kwIrsTrnId || null,
        // Meta
        Boolean(submittedBySurveyor), lodgedAt, notes || null, enteredBy,
      ]
    );

    const lodgment = rows[0];

    // Initialise the 5-stage workflow for this lodgment
    await pool.query(
      'SELECT fn_init_client_workflow($1, $2)',
      [lodgment.id, planNumber]
    );

    // Auto-trigger comparison engine in background
    runAndStore(planNumber, null).catch((err) =>
      console.error(`[Comparison] Auto-run failed for ${planNumber}:`, err.message)
    );

    res.status(201).json(lodgment);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'client_lodgments_plan_number_key') {
      return res.status(409).json({
        error: `A Client Lodgment for plan ${req.body.planNumber} already exists`,
      });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/clients?page=1&limit=20&status=received&q=
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const page   = Math.max(1, Number(req.query.page)   || 1);
    const limit  = Math.min(100, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;
    const { status, q } = req.query;

    const conditions = [];
    const params     = [];
    let   pi         = 1;

    if (status) { conditions.push(`cl.status = $${pi++}`); params.push(status); }
    if (q) {
      conditions.push(
        `(cl.plan_number ILIKE $${pi} OR cl.applicant_name ILIKE $${pi} OR cl.cfc_no ILIKE $${pi})`
      );
      params.push(`%${q}%`); pi++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      pool.query(
        `SELECT
           cl.id, cl.plan_number, cl.applicant_name, cl.applicant_phone,
           cl.cfc_no, cl.lodgement_no, cl.land_no, cl.survey_no, cl.ref_no,
           cl.status, cl.lodged_at, cl.charting_date, cl.cir_issued_at,
           cl.doc_cfc_form, cl.doc_cartographic_report, cl.doc_inspection_report,
           cl.doc_identification_report, cl.doc_lodgement_report,
           cl.created_at
         FROM client_lodgments cl
         ${where}
         ORDER BY cl.created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM client_lodgments cl ${where}`, params),
    ]);

    const total = Number(count.rows[0].count);
    res.json({ data: data.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/clients/:planNumber
// ---------------------------------------------------------------------------
router.get('/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM client_lodgments WHERE plan_number = $1',
      [req.params.planNumber]
    );
    if (!rows.length) {
      return res.status(404).json({ error: `No client lodgment found for plan ${req.params.planNumber}` });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/clients/:planNumber
// Update charting data, 3 status checks, document checklist, and status.
// Called by OSG staff after charting is complete.
// When cirIssuedBy is provided and all 3 charting checks are set,
// cir_issued_at is automatically stamped.
// ---------------------------------------------------------------------------
router.patch('/:planNumber', requireAuth, requireRole('admin', 'staff'), async (req, res, next) => {
  try {
    const { planNumber } = req.params;
    const {
      // Charting data
      beaconNo,
      utmNorthing,
      utmEasting,
      townshipNorthing,
      townshipEasting,
      sizeSqm,
      // 3 status checks
      inGovtAcquisition,
      inGovtAcquisitionRemarks,
      withinExistingTitle,
      withinExistingTitleRemarks,
      freeFromAcquisition,
      freeFromAcquisitionRemarks,
      // Document checklist
      docCfcForm,
      docCartographicReport,
      docInspectionReport,
      docIdentificationReport,
      docLodgementReport,
      // Status
      status,
      chartingDate,
      // Notes
      notes,
    } = req.body;

    // Only admin can issue the CIR — staff can fill charting data
    // cir_issued_by is always set from the token if all charting checks are present
    const allChecksProvided =
      inGovtAcquisition !== undefined &&
      inGovtAcquisition !== null &&
      withinExistingTitle !== undefined &&
      withinExistingTitle !== null &&
      freeFromAcquisition !== undefined &&
      freeFromAcquisition !== null;

    // Only admin can stamp the CIR
    const cirIssuedBy = (allChecksProvided && req.user.role === 'admin') ? req.user.id : null;
    const cirIssuedAt = cirIssuedBy ? new Date().toISOString() : null;

    const { rows } = await pool.query(
      `UPDATE client_lodgments SET
         beacon_no                      = COALESCE($1,  beacon_no),
         utm_northing                   = COALESCE($2,  utm_northing),
         utm_easting                    = COALESCE($3,  utm_easting),
         township_northing              = COALESCE($4,  township_northing),
         township_easting               = COALESCE($5,  township_easting),
         size_sqm                       = COALESCE($6,  size_sqm),
         in_govt_acquisition            = COALESCE($7,  in_govt_acquisition),
         in_govt_acquisition_remarks    = COALESCE($8,  in_govt_acquisition_remarks),
         within_existing_title          = COALESCE($9,  within_existing_title),
         within_existing_title_remarks  = COALESCE($10, within_existing_title_remarks),
         free_from_acquisition          = COALESCE($11, free_from_acquisition),
         free_from_acquisition_remarks  = COALESCE($12, free_from_acquisition_remarks),
         doc_cfc_form                   = COALESCE($13, doc_cfc_form),
         doc_cartographic_report        = COALESCE($14, doc_cartographic_report),
         doc_inspection_report          = COALESCE($15, doc_inspection_report),
         doc_identification_report      = COALESCE($16, doc_identification_report),
         doc_lodgement_report           = COALESCE($17, doc_lodgement_report),
         status                         = COALESCE($18, status),
         charting_date                  = COALESCE($19, charting_date),
         cir_issued_by                  = COALESCE($20::uuid,        cir_issued_by),
         cir_issued_at                  = COALESCE($21::timestamptz, cir_issued_at),
         notes                          = COALESCE($22, notes),
         updated_at                     = NOW()
       WHERE plan_number = $23
       RETURNING *`,
      [
        beaconNo                    ?? null,
        utmNorthing                 ?? null,
        utmEasting                  ?? null,
        townshipNorthing            ?? null,
        townshipEasting             ?? null,
        sizeSqm                     ?? null,
        inGovtAcquisition           ?? null,
        inGovtAcquisitionRemarks    ?? null,
        withinExistingTitle         ?? null,
        withinExistingTitleRemarks  ?? null,
        freeFromAcquisition         ?? null,
        freeFromAcquisitionRemarks  ?? null,
        docCfcForm                  ?? null,
        docCartographicReport       ?? null,
        docInspectionReport         ?? null,
        docIdentificationReport     ?? null,
        docLodgementReport          ?? null,
        status                      ?? null,
        chartingDate                ?? null,
        cirIssuedBy,
        cirIssuedAt,
        notes                       ?? null,
        planNumber,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: `Plan ${planNumber} not found` });

    // Re-run comparison engine after charting data update — background
    runAndStore(planNumber, null).catch((err) =>
      console.error(`[Comparison] Auto-run failed for ${planNumber}:`, err.message)
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;