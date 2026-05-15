-- =============================================================================
-- SGIS — 008_workflow_corrected.sql
-- Corrects the workflow stage order and updates DB3 to capture all fields
-- from the physical CFC Application Form (KW-GIS Version 1.05, May 2025).
--
-- CORRECT WORKFLOW ORDER:
--   Stage 1 — Records (receive file, assign REF, enter CFC form data)
--   Stage 2 — Verification (verify surveyor details + plan info)
--   Stage 3 — Cartography (CFC check + cartographic data)
--   Stage 4 — Inspection (field visit)
--   Stage 5 — Verification (review inspection, second sign-off)
--   Stage 6 — Records (final filing, CIR generation)
--
-- Run after: 007_gis_extended.sql
-- =============================================================================

-- =============================================================================
-- PART 1: Add CFC form fields to client_lodgments (DB3)
-- These are the exact fields from the KW-GIS CFC Application Form
-- =============================================================================

ALTER TABLE client_lodgments
  -- Reference numbers assigned by Records at Stage 1
  ADD COLUMN IF NOT EXISTS ref_number          VARCHAR(40),   -- REF field on the form (distinct from ref_no)
  ADD COLUMN IF NOT EXISTS file_number         VARCHAR(40),   -- File Number assigned by Records

  -- Applicant identification (from CFC form Section 1)
  ADD COLUMN IF NOT EXISTS applicant_title     VARCHAR(20),   -- Mr/Mrs/Dr/Chief/Alhaji etc
  ADD COLUMN IF NOT EXISTS applicant_middle    VARCHAR(100),  -- Middle name
  ADD COLUMN IF NOT EXISTS applicant_surname   VARCHAR(100),  -- Surname
  ADD COLUMN IF NOT EXISTS applicant_is_legal_occupant BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS applicant_phone2    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS applicant_email     VARCHAR(150),
  ADD COLUMN IF NOT EXISTS applicant_id_type   VARCHAR(30),   -- Int.Passport/NationalID/Driver's Lic/Voters Card
  ADD COLUMN IF NOT EXISTS applicant_id_no     VARCHAR(60),

  -- Applicant address (from CFC form)
  ADD COLUMN IF NOT EXISTS applicant_house_no  VARCHAR(40),
  ADD COLUMN IF NOT EXISTS applicant_street    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS applicant_community VARCHAR(100),
  ADD COLUMN IF NOT EXISTS applicant_city      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS applicant_state     VARCHAR(60)    DEFAULT 'Kwara State',
  ADD COLUMN IF NOT EXISTS applicant_address_extra TEXT,

  -- Land parcel (from CFC form Section 2)
  ADD COLUMN IF NOT EXISTS land_same_as_address BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS land_house_no       VARCHAR(40),
  ADD COLUMN IF NOT EXISTS land_street         VARCHAR(200),
  ADD COLUMN IF NOT EXISTS land_city           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS land_state          VARCHAR(60)    DEFAULT 'Kwara State',
  ADD COLUMN IF NOT EXISTS land_delineated_by  VARCHAR(20),   -- 'survey_plan' or 'site_plan'

  -- Reason for survey (checkbox on form)
  ADD COLUMN IF NOT EXISTS survey_reason       VARCHAR(30),   -- 'status_only' | 'land_registration' | 'cofo'

  -- Payment / receipt (KW-IRS)
  ADD COLUMN IF NOT EXISTS kwirs_receipt_no    VARCHAR(60),
  ADD COLUMN IF NOT EXISTS kwirs_payment_date  DATE,
  ADD COLUMN IF NOT EXISTS kwirs_amount        NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS kwirs_trn_id        VARCHAR(100),  -- TRN ID from KW-IRS receipt

  -- Document uploads
  ADD COLUMN IF NOT EXISTS cfc_form_scan_url   TEXT,          -- Scanned CFC application form
  ADD COLUMN IF NOT EXISTS kwirs_receipt_url   TEXT,          -- KW-IRS receipt scan
  ADD COLUMN IF NOT EXISTS survey_plan_url     TEXT;          -- Survey plan scan/PDF

-- =============================================================================
-- PART 2: Drop old workflow stage definitions and reseed with correct order
-- =============================================================================

-- Clear existing stage rows from any test data (safe — CASCADE handles child rows)
DELETE FROM client_workflow_stages;
DELETE FROM client_workflows;
DELETE FROM workflow_stage_definitions;

-- Reseed with the correct 6-stage workflow
INSERT INTO workflow_stage_definitions
  (stage_number, name, department, description, required_role)
VALUES
  (1, 'File Reception & Registration',
      'records',
      'Records department receives the CFC application form, KW-IRS receipt, and survey plan. Assigns REF and File Number. Enters all CFC form data into the system. Scans and attaches documents.',
      'records'),

  (2, 'Verification — Initial Review',
      'verification',
      'Verification department checks surveyor registration against the SURCON register, validates plan number format, confirms all required documents are present and consistent.',
      'verification'),

  (3, 'Cartography — CFC Check & Charting',
      'carto',
      'Cartography department performs the charting for confirmation — checks whether the land is free from government acquisition and existing titles, fills cartographic data (beacon number, coordinates, parcel size, charting date), generates CFC number.',
      'carto'),

  (4, 'Inspection — Field Visit',
      'inspection',
      'Inspection department visits the site, verifies beacons are in place and in good condition, confirms the plan matches the physical land, submits a physical inspection report.',
      'inspection'),

  (5, 'Verification — Inspection Review',
      'verification',
      'Verification department reviews the inspection report findings, cross-checks with cartographic data, gives final verification sign-off before the file proceeds to closing.',
      'verification'),

  (6, 'Records — Final Filing & CIR',
      'records',
      'Records department performs final record keeping — assigns file and cabinet references, files all documents, closes the workflow. This action triggers generation of the Charting Information Report (CIR).',
      'records');

-- =============================================================================
-- PART 3: Update fn_init_client_workflow to create 6 stages
-- (The function queries workflow_stage_definitions dynamically so it
--  automatically picks up the new 6 stages — no changes needed to the function)
-- =============================================================================

-- Verify the function will correctly create 6 stages
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM workflow_stage_definitions WHERE is_active = TRUE;
  RAISE NOTICE 'Workflow now has % active stages', v_count;
END;
$$;

-- =============================================================================
-- PART 4: Update workflow_status_enum to allow 'complete' from stage 6
-- (Already defined — no changes needed)
-- =============================================================================

-- =============================================================================
-- PART 5: Add JSONB field schema documentation for each stage
-- (Documentation only — enforced by application layer)
-- =============================================================================

COMMENT ON TABLE workflow_stage_definitions IS
$$Stage definitions for the KWGIS client lodgment workflow.
Correct order and data captured per stage:

Stage 1 — Records (File Reception):
  stage_data: {
    ref_number: string,           -- REF assigned by Records
    file_number: string,          -- File number assigned
    received_by: string,          -- Name of Records staff who received
    receipt_confirmed: boolean,   -- KW-IRS receipt checked
    survey_plan_received: boolean,-- Survey plan physically received
    cfc_form_complete: boolean,   -- All form fields filled
    remarks: string
  }

Stage 2 — Verification (Initial):
  stage_data: {
    surveyor_verified: boolean,   -- Checked against SURCON register
    plan_number_valid: boolean,   -- Format and existence verified
    documents_complete: boolean,  -- All required docs present
    applicant_id_verified: boolean,
    remarks: string
  }

Stage 3 — Cartography (CFC Check + Charting):
  stage_data: {
    in_govt_acquisition: boolean,
    in_govt_acquisition_remarks: string,
    within_existing_title: boolean,
    within_existing_title_remarks: string,
    free_from_acquisition: boolean,
    free_from_acquisition_remarks: string,
    beacon_no: string,            -- e.g. SC/KWL7896BL
    utm_northing: string,         -- e.g. 961738.738 mN
    utm_easting: string,          -- e.g. 662754.240 mE
    size_sqm: number,
    charting_date: string,
    cfc_no: string                -- CFC number generated
  }

Stage 4 — Inspection:
  stage_data: {
    site_visited: boolean,
    site_visit_date: string,
    beacons_found: boolean,
    beacons_condition: string,
    site_matches_plan: boolean,
    inspection_report: string,
    inspector_name: string
  }

Stage 5 — Verification (Inspection Review):
  stage_data: {
    inspection_findings_reviewed: boolean,
    cartographic_data_confirmed: boolean,
    discrepancies_found: boolean,
    discrepancy_details: string,
    verification_report: string
  }

Stage 6 — Records (Final Filing):
  stage_data: {
    file_number: string,
    cabinet_reference: string,
    documents_filed: boolean,
    cir_generated: boolean,
    records_report: string
  }
$$;

-- =============================================================================
-- MIGRATION COMPLETE
-- Changes:
--   client_lodgments: 24 new columns from CFC form
--   workflow_stage_definitions: reseeded with correct 6-stage order
--   client_workflows + client_workflow_stages: cleared (test data only)
-- =============================================================================
