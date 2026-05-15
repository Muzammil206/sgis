// src/routes/documents.js
// Phase 7 — Document Generation
//
// GET /api/documents/certificate/:planNumber   Lodgement Certificate data
// GET /api/documents/cir/:planNumber           Charting Information Report data
//
// These endpoints return structured JSON that the frontend renders into
// a printable document. The data is assembled exactly as defined in
// Master Plan Sections 5.2 and 6.2.

import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/documents/certificate/:planNumber
// Returns all data needed to render the Lodgement Certificate.
// Matches the official KW-GIS Lodgement Certificate format (Section 5.2).
// Certificate must be in 'reviewed' or 'issued' status to be returned for print.
// ---------------------------------------------------------------------------
router.get('/certificate/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    // Join DB2 with DB1 for full certificate data
    const { rows } = await pool.query(
      `SELECT
         -- Certificate fields
         sl.certificate_no,
         sl.certificate_status,
         sl.certificate_issued_at,
         su.full_name              AS issued_by_name,

         -- Plan & survey info
         sl.plan_number,
         sl.owner_name,
         sl.location,
         sl.lga,
         sl.coordinate_system,
         sl.utm_northing,
         sl.utm_easting,
         sl.township_northing,
         sl.township_easting,
         sl.actual_area_sqm,
         sl.scale,
         sl.date_of_survey,
         sl.date_signed,
         sl.date_lodged,
         sl.quarter,
         sl.year,
         sl.pillar_prefix,
         sl.pillars_used,
         sl.pillar_numbers,

         -- Uploaded documents (paths for frontend rendering)
         sl.plan_scan_url,
         sl.stamp_image_url,
         sl.red_copy_scan_url,

         -- Surveyor
         sl.surveyor_name,
         sl.surveyor_reg_no,
         sl.firm_name,

         -- CFC number from DB3 if it exists
         cl.cfc_no

       FROM surveyor_lodgments sl
       LEFT JOIN staff_users       su ON su.id           = sl.certificate_issued_by
       LEFT JOIN client_lodgments  cl ON cl.plan_number  = sl.plan_number
       WHERE sl.plan_number = $1`,
      [planNumber]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `No Surveyor Lodgment found for plan ${planNumber}` });
    }

    const cert = rows[0];

    if (cert.certificate_status === 'draft') {
      return res.status(403).json({
        error: 'Certificate is still in draft status. A staff member must review it before it can be printed.',
        certificate_status: cert.certificate_status,
      });
    }

    res.json({
      document:  'Lodgement Certificate',
      printable: cert.certificate_status === 'issued',
      ...cert,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/documents/cir/:planNumber
// Returns all data needed to render the Charting Information Report (CIR).
// Matches the official KW-GIS CIR format (Section 6.2).
// Requires DB3 charting data (all 3 status checks) to be complete.
// ---------------------------------------------------------------------------
router.get('/cir/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    const { rows } = await pool.query(
      `SELECT
         -- CIR reference numbers
         cl.ref_no,
         cl.cfc_no,
         cl.lodgement_no,
         cl.land_no,
         cl.survey_no,
         cl.cir_issued_at,
         su.full_name                    AS certified_by_name,

         -- Applicant (addressee)
         cl.applicant_name,
         cl.applicant_phone,

         -- Plan link
         cl.plan_number,

         -- Charting data
         cl.beacon_no,
         cl.utm_northing,
         cl.utm_easting,
         cl.township_northing,
         cl.township_easting,
         cl.size_sqm,
         cl.charting_date,

         -- 3 status checks
         cl.in_govt_acquisition,
         cl.in_govt_acquisition_remarks,
         cl.within_existing_title,
         cl.within_existing_title_remarks,
         cl.free_from_acquisition,
         cl.free_from_acquisition_remarks,

         -- Document checklist
         cl.doc_cfc_form,
         cl.doc_cartographic_report,
         cl.doc_inspection_report,
         cl.doc_identification_report,
         cl.doc_lodgement_report,

         -- Location from DB1
         pa.location,
         pa.lga,

         -- Surveyor from DB2 (for CIR)
         sl.surveyor_name,
         sl.surveyor_reg_no,
         sl.date_signed

       FROM client_lodgments    cl
       JOIN pillar_applications  pa ON pa.plan_number = cl.plan_number
       LEFT JOIN surveyor_lodgments sl ON sl.plan_number = cl.plan_number
       LEFT JOIN staff_users        su ON su.id          = cl.cir_issued_by
       WHERE cl.plan_number = $1`,
      [planNumber]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `No Client Lodgment found for plan ${planNumber}` });
    }

    const cir = rows[0];

    // Check if charting is complete — all 3 checks must be non-null
    const chartingComplete =
      cir.in_govt_acquisition  !== null &&
      cir.within_existing_title !== null &&
      cir.free_from_acquisition !== null;

    if (!chartingComplete) {
      return res.status(403).json({
        error: 'Charting Information Report cannot be generated — all 3 status checks must be completed first.',
        charting_complete: false,
      });
    }

    res.json({
      document:          'Charting Information Report',
      charting_complete: chartingComplete,
      printable:         !!cir.cir_issued_at,
      ...cir,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
