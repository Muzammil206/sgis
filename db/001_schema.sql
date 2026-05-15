-- =============================================================================
-- SGIS — Surveyor General Information System
-- Office of the Surveyor General · KWGIS · Kwara State
-- 001_schema.sql — Full PostgreSQL Database Schema
-- Developer: Naviss Technologies
-- =============================================================================
-- Run order:
--   psql -U postgres -c "CREATE DATABASE sgis;"
--   psql -U postgres -d sgis -f db/001_schema.sql
--   psql -U postgres -d sgis -f db/002_seed_surveyors.sql
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUID generation
CREATE EXTENSION IF NOT EXISTS "postgis";      -- Spatial (future map features)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- Trigram search (autocomplete)


-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE surveyor_status_enum AS ENUM (
  'active',
  'inactive'
);

CREATE TYPE land_use_type_enum AS ENUM (
  'residential',
  'commercial',
  'agricultural',
  'institutional',
  'industrial'
);

CREATE TYPE quarter_enum AS ENUM (
  'Q1',  -- Jan–Mar
  'Q2',  -- Apr–Jun
  'Q3',  -- Jul–Sep
  'Q4'   -- Oct–Dec
);

CREATE TYPE application_status_enum AS ENUM (
  'pending',    -- DB1 created, awaiting DB2
  'complete',   -- DB2 matched and saved
  'flagged',    -- Comparison Engine raised a FLAG
  'cancelled'
);

CREATE TYPE certificate_status_enum AS ENUM (
  'draft',     -- Auto-generated on DB2 save, not yet reviewed
  'reviewed',  -- Reviewed by staff
  'issued'     -- Officially issued to surveyor
);

CREATE TYPE lodgment_status_enum AS ENUM (
  'received',
  'under_review',
  'approved',
  'rejected',
  'on_hold'
);

CREATE TYPE comparison_status_enum AS ENUM (
  'clean',      -- All checks pass — CofO may proceed
  'flagged',    -- One or more FLAG-level checks — CofO blocked
  'warning',    -- One or more WARNs, no FLAGs — CofO with sign-off
  'incomplete'  -- DB2 or DB3 missing — cannot compare yet
);

CREATE TYPE user_role_enum AS ENUM (
  'admin',
  'staff',
  'viewer'
);


-- =============================================================================
-- TABLE: staff_users
-- OSG staff who operate SGIS. Used for auth and audit trail.
-- =============================================================================

CREATE TABLE staff_users (
  id            UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name     VARCHAR(200)    NOT NULL,
  email         VARCHAR(150)    NOT NULL UNIQUE,
  password_hash TEXT            NOT NULL,
  role          user_role_enum  NOT NULL DEFAULT 'staff',
  is_active     BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staff_users IS 'OSG staff accounts — used for login, entered_by, and audit trail attribution.';


-- =============================================================================
-- TABLE: surveyors
-- Pre-loaded read-only register of all SURCON-licensed surveyors in Kwara State.
-- This is the autocomplete source for ALL forms — surveyor data is never typed freehand.
-- =============================================================================

CREATE TABLE surveyors (
  id            UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       VARCHAR(20)           NOT NULL UNIQUE,  -- e.g. AD3465, H1198, BT5136
  name          VARCHAR(200)          NOT NULL,          -- e.g. SURV. SAMUEL OLUWAFEMI MUYIWA
  surveyor_reg  VARCHAR(20)           NOT NULL UNIQUE,  -- SURCON reg no. e.g. 3465
  phone         VARCHAR(20)           NOT NULL,
  email         VARCHAR(150),
  firm_name     VARCHAR(200),
  firm_phone    VARCHAR(20),
  status        surveyor_status_enum  NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE surveyors IS 'Pre-seeded register of all licensed surveyors in Kwara State. Read-only reference — autocomplete source on all forms.';
COMMENT ON COLUMN surveyors.user_id      IS 'Prefix+number code assigned by OSG e.g. AD3465';
COMMENT ON COLUMN surveyors.surveyor_reg IS 'SURCON registration number — unique identifier used for cross-record matching in comparison engine';

-- Trigram GIN indexes for fast partial-match autocomplete across all searchable fields
CREATE INDEX idx_surveyors_name_trgm   ON surveyors USING GIN (name gin_trgm_ops);
CREATE INDEX idx_surveyors_reg_trgm    ON surveyors USING GIN (surveyor_reg gin_trgm_ops);
CREATE INDEX idx_surveyors_userid_trgm ON surveyors USING GIN (user_id gin_trgm_ops);
CREATE INDEX idx_surveyors_phone_trgm  ON surveyors USING GIN (phone gin_trgm_ops);
CREATE INDEX idx_surveyors_status      ON surveyors (status);


-- =============================================================================
-- TABLE: pillar_applications  (DB1)
-- Created when a licensed surveyor visits OSG BEFORE fieldwork to apply for
-- pillar numbers. The plan_number assigned here is the master link key
-- across all three databases.
-- =============================================================================

CREATE TABLE pillar_applications (
  id                    UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- SURVEYOR — auto-filled from register; denormalised snapshot at time of entry
  surveyor_id           UUID                    NOT NULL REFERENCES surveyors(id),
  surveyor_name         VARCHAR(200)            NOT NULL,
  surveyor_reg_no       VARCHAR(20)             NOT NULL,
  firm_name             VARCHAR(200),
  firm_phone            VARCHAR(20),

  -- PLAN NUMBER — master link key
  plan_number           VARCHAR(40)             NOT NULL UNIQUE,  -- KW/Serial/Reg.No./Year e.g. KW/3465/47/2024
  date_applied          DATE                    NOT NULL,

  -- PILLAR NUMBERS
  pillar_prefix         VARCHAR(10)             NOT NULL,   -- e.g. SC/KW
  pillars_requested     SMALLINT                NOT NULL CHECK (pillars_requested > 0),
  pillar_numbers        TEXT[]                  NOT NULL,   -- e.g. {J6169AD, J6170AD, J6171AD, J6172AD}

  -- LAND DETAILS
  location              TEXT                    NOT NULL,
  lga                   VARCHAR(100)            NOT NULL,
  land_use_type         land_use_type_enum      NOT NULL,
  estimated_area_sqm    NUMERIC(12,3)           NOT NULL CHECK (estimated_area_sqm > 0),

  -- QUARTER & FEE
  quarter               quarter_enum            NOT NULL,
  year                  SMALLINT                NOT NULL CHECK (year >= 2000 AND year <= 2100),
  fee_paid              NUMERIC(12,2)           NOT NULL CHECK (fee_paid >= 0),
  receipt_number        VARCHAR(60)             NOT NULL,
  payment_date          DATE                    NOT NULL,

  -- STATUS & METADATA
  status                application_status_enum NOT NULL DEFAULT 'pending',
  notes                 TEXT,
  entered_by            UUID                    NOT NULL REFERENCES staff_users(id),
  created_at            TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pillar_applications IS 'DB1 — Created before fieldwork. plan_number is the master link key. Status starts pending, flips to complete when DB2 is saved.';
COMMENT ON COLUMN pillar_applications.plan_number       IS 'Format: KW/Serial/Reg.No./Year e.g. KW/3465/47/2024. Globally unique. Master link key across all 3 databases.';
COMMENT ON COLUMN pillar_applications.pillar_numbers    IS 'Array of all pillar numbers issued. Each number is globally unique — enforced by pillar_number_registry trigger.';

CREATE INDEX idx_pa_plan_number   ON pillar_applications (plan_number);
CREATE INDEX idx_pa_surveyor_id   ON pillar_applications (surveyor_id);
CREATE INDEX idx_pa_status        ON pillar_applications (status);
CREATE INDEX idx_pa_year_quarter  ON pillar_applications (year, quarter);
CREATE INDEX idx_pa_lga           ON pillar_applications (lga);
CREATE INDEX idx_pa_plan_trgm     ON pillar_applications USING GIN (plan_number gin_trgm_ops);


-- =============================================================================
-- TABLE: pillar_number_registry
-- Enforces global uniqueness of every pillar number ever issued.
-- Populated automatically by trigger on pillar_applications INSERT.
-- =============================================================================

CREATE TABLE pillar_number_registry (
  pillar_number   VARCHAR(30)  PRIMARY KEY,
  application_id  UUID         NOT NULL REFERENCES pillar_applications(id),
  plan_number     VARCHAR(40)  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE pillar_number_registry IS 'Global registry of all issued pillar numbers. Prevents any pillar number appearing on more than one application. Populated by trigger.';


-- =============================================================================
-- TABLE: surveyor_lodgments  (DB2)
-- Created when surveyor returns AFTER fieldwork to lodge the completed plan.
-- Generates the Lodgement Certificate.
-- =============================================================================

CREATE TABLE surveyor_lodgments (
  id                      UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- PLAN LINK
  plan_number             VARCHAR(40)             NOT NULL UNIQUE REFERENCES pillar_applications(plan_number),
  application_id          UUID                    NOT NULL REFERENCES pillar_applications(id),

  -- SURVEYOR — auto-filled and locked from DB1; editable only by staff override
  surveyor_id             UUID                    NOT NULL REFERENCES surveyors(id),
  surveyor_name           VARCHAR(200)            NOT NULL,
  surveyor_reg_no         VARCHAR(20)             NOT NULL,
  firm_name               VARCHAR(200),

  -- LAND OWNER
  owner_name              VARCHAR(200)            NOT NULL,

  -- PILLAR INFORMATION
  pillar_prefix           VARCHAR(10)             NOT NULL,
  pillars_used            SMALLINT                NOT NULL CHECK (pillars_used > 0),
  pillar_numbers          TEXT[]                  NOT NULL,  -- Must be subset of DB1 pillar_numbers

  -- ACTUAL MEASUREMENTS
  actual_area_sqm         NUMERIC(12,3)           NOT NULL CHECK (actual_area_sqm > 0),
  coordinate_system       VARCHAR(100)            NOT NULL,  -- e.g. U.T.M. Zone 31 / Minna Datum
  utm_northing            VARCHAR(30)             NOT NULL,  -- e.g. 892860.414 mN
  utm_easting             VARCHAR(30)             NOT NULL,  -- e.g. 700394.777 mE
  township_northing       VARCHAR(30),
  township_easting        VARCHAR(30),
  scale                   VARCHAR(20)             NOT NULL,  -- e.g. 1:500

  -- LOCATION — auto-filled from DB1, editable
  location                TEXT                    NOT NULL,
  lga                     VARCHAR(100)            NOT NULL,

  -- DATES
  date_of_survey          DATE                    NOT NULL,
  date_signed             DATE                    NOT NULL,
  date_lodged             DATE                    NOT NULL,  -- Physical lodgment date — may differ from created_at

  -- QUARTER/YEAR — auto-filled from DB1, editable
  quarter                 quarter_enum            NOT NULL,
  year                    SMALLINT                NOT NULL CHECK (year >= 2000 AND year <= 2100),

  -- UPLOADED DOCUMENTS
  plan_scan_url           TEXT,    -- PDF/image of the completed survey plan
  stamp_image_url         TEXT,    -- Surveyor stamp image
  red_copy_scan_url       TEXT,    -- Scanned RED COPY

  -- LODGEMENT CERTIFICATE (auto-generated on save, staff reviews before issuing)
  certificate_no          VARCHAR(60)             UNIQUE,   -- e.g. KWGIS/OSG/LGC/023/2025
  certificate_status      certificate_status_enum NOT NULL DEFAULT 'draft',
  certificate_issued_by   UUID                    REFERENCES staff_users(id),
  certificate_issued_at   TIMESTAMPTZ,

  -- METADATA
  notes                   TEXT,
  entered_by              UUID                    NOT NULL REFERENCES staff_users(id),
  created_at              TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

  -- STANDALONE FLAG (generated column: true if no DB1 match)
  is_standalone           BOOLEAN                 GENERATED ALWAYS AS (application_id IS NULL) STORED
);

COMMENT ON TABLE surveyor_lodgments IS 'DB2 — Created after fieldwork when surveyor lodges completed plan. Auto-generates Lodgement Certificate (draft). Updates DB1 status to complete.';
COMMENT ON COLUMN surveyor_lodgments.date_lodged       IS 'Physical lodgment date — may differ from system entry date (created_at).';
COMMENT ON COLUMN surveyor_lodgments.certificate_no    IS 'Auto-generated: KWGIS/OSG/LGC/{3-digit serial}/{year}';
COMMENT ON COLUMN surveyor_lodgments.pillar_numbers    IS 'Actual pillar numbers placed in the field. Must be a subset of DB1 pillar_numbers — validated by Comparison Engine.';

CREATE INDEX idx_sl_plan_number   ON surveyor_lodgments (plan_number);
CREATE INDEX idx_sl_surveyor_id   ON surveyor_lodgments (surveyor_id);
CREATE INDEX idx_sl_cert_status   ON surveyor_lodgments (certificate_status);
CREATE INDEX idx_sl_year_quarter  ON surveyor_lodgments (year, quarter);


-- =============================================================================
-- TABLE: client_lodgments  (DB3)
-- Created when client brings RED COPY to OSG to apply for CofO.
-- Generates the Charting Information Report (CIR).
-- =============================================================================

CREATE TABLE client_lodgments (
  id                              UUID                  PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- PLAN LINK
  plan_number                     VARCHAR(40)           NOT NULL UNIQUE REFERENCES pillar_applications(plan_number),
  application_id                  UUID                  NOT NULL REFERENCES pillar_applications(id),

  -- OSG REFERENCE NUMBERS — all auto-generated, never manually entered
  cfc_no                          VARCHAR(60)           UNIQUE,  -- KWGIS/OSG/{serial}/PG{serial}
  lodgement_no                    VARCHAR(60)           UNIQUE,  -- LDG/KW/{year}/{4-digit serial}
  land_no                         VARCHAR(60)           UNIQUE,  -- LND/KW/{year}/{4-digit serial}
  survey_no                       VARCHAR(60)           UNIQUE,  -- SVY/KW/{year}/{4-digit serial}
  ref_no                          VARCHAR(60)           UNIQUE,  -- CIR ref: KWGIS/OSG/{serial}/C{serial}

  -- APPLICANT
  applicant_name                  VARCHAR(200)          NOT NULL,
  applicant_phone                 VARCHAR(20),
  submitted_by_surveyor           BOOLEAN               NOT NULL DEFAULT FALSE,

  -- CHARTING DATA — filled by OSG staff after charting
  beacon_no                       VARCHAR(40),          -- e.g. PBIL. 6249
  utm_northing                    VARCHAR(30),
  utm_easting                     VARCHAR(30),
  township_northing               VARCHAR(30),
  township_easting                VARCHAR(30),
  size_sqm                        NUMERIC(12,3)         CHECK (size_sqm IS NULL OR size_sqm > 0),

  -- 3 STATUS CHECKS — results of charting
  in_govt_acquisition             BOOLEAN,
  in_govt_acquisition_remarks     TEXT,
  within_existing_title           BOOLEAN,
  within_existing_title_remarks   TEXT,
  free_from_acquisition           BOOLEAN,
  free_from_acquisition_remarks   TEXT,

  -- DOCUMENTS CHECKLIST — 5 required supporting documents
  doc_cfc_form                    BOOLEAN               NOT NULL DEFAULT FALSE,
  doc_cartographic_report         BOOLEAN               NOT NULL DEFAULT FALSE,
  doc_inspection_report           BOOLEAN               NOT NULL DEFAULT FALSE,
  doc_identification_report       BOOLEAN               NOT NULL DEFAULT FALSE,
  doc_lodgement_report            BOOLEAN               NOT NULL DEFAULT FALSE,

  -- STATUS & DATES
  status                          lodgment_status_enum  NOT NULL DEFAULT 'received',
  lodged_at                       DATE                  NOT NULL,
  charting_date                   DATE,
  cir_issued_at                   TIMESTAMPTZ,
  cir_issued_by                   UUID                  REFERENCES staff_users(id),

  -- METADATA
  notes                           TEXT,
  entered_by                      UUID                  NOT NULL REFERENCES staff_users(id),
  created_at                      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  -- STANDALONE FLAG (generated column: true if no DB1 match)
  is_standalone                   BOOLEAN               GENERATED ALWAYS AS (application_id IS NULL) STORED
);

COMMENT ON TABLE client_lodgments IS 'DB3 — Created when client submits RED COPY for CofO. Auto-generates 5 reference numbers. Generates Charting Information Report after charting checks are complete.';
COMMENT ON COLUMN client_lodgments.cfc_no        IS 'Auto-generated: KWGIS/OSG/{serial}/PG{serial}';
COMMENT ON COLUMN client_lodgments.lodgement_no  IS 'Auto-generated: LDG/KW/{year}/{4-digit serial}';
COMMENT ON COLUMN client_lodgments.land_no       IS 'Auto-generated: LND/KW/{year}/{4-digit serial}';
COMMENT ON COLUMN client_lodgments.survey_no     IS 'Auto-generated: SVY/KW/{year}/{4-digit serial}';
COMMENT ON COLUMN client_lodgments.ref_no        IS 'CIR reference number: KWGIS/OSG/{serial}/C{serial}';

CREATE INDEX idx_cl_plan_number  ON client_lodgments (plan_number);
CREATE INDEX idx_cl_status       ON client_lodgments (status);
CREATE INDEX idx_cl_applicant    ON client_lodgments (applicant_name);
CREATE INDEX idx_cl_lodged_at    ON client_lodgments (lodged_at);


-- =============================================================================
-- TABLE: comparison_results
-- Output of the Comparison Engine for each plan number.
-- One row per engine run — latest row is the current result.
-- =============================================================================

CREATE TABLE comparison_results (
  id                    UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_number           VARCHAR(40)             NOT NULL REFERENCES pillar_applications(plan_number),
  application_id        UUID                    NOT NULL REFERENCES pillar_applications(id),
  lodgment_id           UUID                    REFERENCES surveyor_lodgments(id),
  client_lodgment_id    UUID                    REFERENCES client_lodgments(id),

  -- RESULT
  overall_status        comparison_status_enum  NOT NULL,
  checks                JSONB                   NOT NULL DEFAULT '[]',
  -- checks format: [{check, flag_type, passed, detail}]
  -- e.g. {"check":"area_discrepancy","flag_type":"FLAG","passed":false,"detail":"Diff 8.3% > 5% threshold"}

  -- COUNTS
  flag_count            SMALLINT                NOT NULL DEFAULT 0,
  warn_count            SMALLINT                NOT NULL DEFAULT 0,
  info_count            SMALLINT                NOT NULL DEFAULT 0,

  -- AUDIT
  run_by                UUID                    REFERENCES staff_users(id),  -- NULL = auto-triggered
  run_at                TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE comparison_results IS 'Output of the Comparison Engine. Re-generated on each run. Latest row per plan_number is the current result.';

CREATE INDEX idx_cr_plan_number    ON comparison_results (plan_number);
CREATE INDEX idx_cr_overall_status ON comparison_results (overall_status);
CREATE INDEX idx_cr_run_at         ON comparison_results (run_at DESC);


-- =============================================================================
-- TABLE: reference_number_sequences
-- Thread-safe sequential counters for all auto-generated reference numbers.
-- One row per document type per year — auto-created on first use.
-- =============================================================================

CREATE TABLE reference_number_sequences (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  doc_type     VARCHAR(10) NOT NULL,   -- LGC | CFC | CIR | LDG | LND | SVY
  year         SMALLINT    NOT NULL,
  last_serial  INTEGER     NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (doc_type, year)
);

COMMENT ON TABLE reference_number_sequences IS 'Sequential counters for auto-generated reference numbers. Thread-safe via UPDATE ... RETURNING. One row per doc_type per year.';


-- =============================================================================
-- TABLE: audit_log
-- Immutable record of every create/update/delete on core tables.
-- =============================================================================

CREATE TABLE audit_log (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name  VARCHAR(60) NOT NULL,
  record_id   UUID        NOT NULL,
  action      VARCHAR(10) NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  changed_by  UUID        REFERENCES staff_users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_data    JSONB,
  new_data    JSONB
);

COMMENT ON TABLE audit_log IS 'Immutable audit trail. Every action on core tables is recorded here. Never updated or deleted.';

CREATE INDEX idx_audit_table_record ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_changed_by   ON audit_log (changed_by);
CREATE INDEX idx_audit_changed_at   ON audit_log (changed_at DESC);


-- =============================================================================
-- TABLE: lgas
-- The 16 Local Government Areas of Kwara State.
-- Reference table for form dropdowns.
-- =============================================================================

CREATE TABLE lgas (
  code  VARCHAR(10)  PRIMARY KEY,
  name  VARCHAR(100) NOT NULL UNIQUE
);

COMMENT ON TABLE lgas IS 'The 16 LGAs of Kwara State. Used as dropdown reference on forms.';

INSERT INTO lgas (code, name) VALUES
  ('ASO', 'Asa'),
  ('BAR', 'Baruten'),
  ('EDU', 'Edu'),
  ('EKI', 'Ekiti'),
  ('IFE', 'Ifelodun'),
  ('ILE', 'Ilorin East'),
  ('ILS', 'Ilorin South'),
  ('ILW', 'Ilorin West'),
  ('IRP', 'Irepodun'),
  ('ISI', 'Isin'),
  ('KAI', 'Kaiama'),
  ('MOR', 'Moro'),
  ('OFF', 'Offa'),
  ('OKE', 'Oke-Ero'),
  ('OYU', 'Oyun'),
  ('PAT', 'Pategi');


-- =============================================================================
-- FUNCTION & TRIGGERS: updated_at auto-stamp
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_updated_at_staff_users
  BEFORE UPDATE ON staff_users
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_pillar_applications
  BEFORE UPDATE ON pillar_applications
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_surveyor_lodgments
  BEFORE UPDATE ON surveyor_lodgments
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_client_lodgments
  BEFORE UPDATE ON client_lodgments
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- =============================================================================
-- TRIGGER: Enforce global pillar number uniqueness on DB1 INSERT
-- Runs AFTER INSERT on pillar_applications.
-- Rejects the entire insert if any pillar number is already registered.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_register_pillar_numbers()
RETURNS TRIGGER AS $$
DECLARE
  pn TEXT;
BEGIN
  -- Check ALL pillar numbers first before inserting any
  FOREACH pn IN ARRAY NEW.pillar_numbers LOOP
    IF EXISTS (SELECT 1 FROM pillar_number_registry WHERE pillar_number = pn) THEN
      RAISE EXCEPTION 'Pillar number % is already registered to plan %.', pn,
        (SELECT plan_number FROM pillar_number_registry WHERE pillar_number = pn);
    END IF;
  END LOOP;

  -- All clear — register each pillar number
  FOREACH pn IN ARRAY NEW.pillar_numbers LOOP
    INSERT INTO pillar_number_registry (pillar_number, application_id, plan_number)
    VALUES (pn, NEW.id, NEW.plan_number);
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_register_pillar_numbers
  AFTER INSERT ON pillar_applications
  FOR EACH ROW EXECUTE FUNCTION fn_register_pillar_numbers();


-- =============================================================================
-- TRIGGER: Auto-update DB1 status to 'complete' when DB2 is saved
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_complete_application_on_lodgment()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE pillar_applications
  SET    status = 'complete', updated_at = NOW()
  WHERE  id = NEW.application_id
    AND  status = 'pending';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_complete_on_lodgment
  AFTER INSERT ON surveyor_lodgments
  FOR EACH ROW EXECUTE FUNCTION fn_complete_application_on_lodgment();


-- =============================================================================
-- FUNCTION: generate_reference_number(doc_type, year)
-- Thread-safe atomic increment. Called by application layer when generating
-- any auto-reference number (LGC, CFC, CIR, LDG, LND, SVY).
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_reference_number(p_doc_type VARCHAR, p_year SMALLINT)
RETURNS INTEGER AS $$
DECLARE
  v_serial INTEGER;
BEGIN
  -- Create row if this is the first reference of this type/year
  INSERT INTO reference_number_sequences (doc_type, year, last_serial)
  VALUES (p_doc_type, p_year, 0)
  ON CONFLICT (doc_type, year) DO NOTHING;

  -- Atomically increment and return
  UPDATE reference_number_sequences
  SET    last_serial = last_serial + 1,
         updated_at  = NOW()
  WHERE  doc_type = p_doc_type AND year = p_year
  RETURNING last_serial INTO v_serial;

  RETURN v_serial;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_reference_number IS 'Thread-safe sequential counter. Call once per document on creation. Never re-use returned serials.';


-- =============================================================================
-- VIEWS
-- =============================================================================

-- Full plan summary: all 3 databases + latest comparison result
CREATE VIEW v_plan_summary AS
SELECT
  pa.plan_number,
  pa.id                   AS application_id,
  pa.status               AS application_status,
  pa.date_applied,
  pa.quarter,
  pa.year,
  pa.lga,
  pa.location,
  pa.land_use_type,
  pa.estimated_area_sqm,
  pa.pillars_requested,
  pa.pillar_numbers        AS issued_pillar_numbers,
  -- Surveyor
  s.name                  AS surveyor_name,
  s.surveyor_reg          AS surveyor_reg_no,
  s.phone                 AS surveyor_phone,
  -- DB2
  sl.id                   AS lodgment_id,
  sl.actual_area_sqm,
  sl.pillars_used,
  sl.date_lodged,
  sl.certificate_no,
  sl.certificate_status,
  sl.owner_name,
  -- DB3
  cl.id                   AS client_lodgment_id,
  cl.applicant_name,
  cl.cfc_no,
  cl.lodgement_no,
  cl.land_no,
  cl.survey_no,
  cl.ref_no,
  cl.status               AS client_status,
  cl.cir_issued_at,
  -- Latest comparison
  cr.overall_status       AS comparison_status,
  cr.flag_count,
  cr.warn_count,
  cr.checks               AS comparison_checks,
  cr.run_at               AS last_compared_at
FROM pillar_applications pa
JOIN  surveyors              s   ON s.id           = pa.surveyor_id
LEFT JOIN surveyor_lodgments sl  ON sl.plan_number = pa.plan_number
LEFT JOIN client_lodgments   cl  ON cl.plan_number = pa.plan_number
LEFT JOIN LATERAL (
  SELECT overall_status, flag_count, warn_count, checks, run_at
  FROM   comparison_results
  WHERE  plan_number = pa.plan_number
  ORDER  BY run_at DESC
  LIMIT  1
) cr ON TRUE;

-- Pending applications (DB1 with no DB2 yet)
CREATE VIEW v_pending_applications AS
SELECT
  pa.plan_number,
  pa.date_applied,
  pa.quarter,
  pa.year,
  s.name          AS surveyor_name,
  s.surveyor_reg  AS surveyor_reg_no,
  pa.location,
  pa.lga,
  pa.land_use_type,
  pa.estimated_area_sqm,
  pa.pillars_requested,
  pa.fee_paid,
  pa.created_at
FROM pillar_applications pa
JOIN surveyors s ON s.id = pa.surveyor_id
WHERE pa.status = 'pending'
ORDER BY pa.date_applied DESC;

-- Flagged plans
CREATE VIEW v_flagged_plans AS
SELECT
  pa.plan_number,
  pa.status           AS application_status,
  s.name              AS surveyor_name,
  pa.location,
  pa.lga,
  cr.overall_status   AS comparison_status,
  cr.flag_count,
  cr.warn_count,
  cr.checks,
  cr.run_at           AS flagged_at
FROM pillar_applications pa
JOIN surveyors s ON s.id = pa.surveyor_id
LEFT JOIN LATERAL (
  SELECT overall_status, flag_count, warn_count, checks, run_at
  FROM   comparison_results
  WHERE  plan_number = pa.plan_number
  ORDER  BY run_at DESC
  LIMIT  1
) cr ON TRUE
WHERE pa.status = 'flagged'
   OR cr.overall_status IN ('flagged', 'warning')
ORDER BY cr.run_at DESC NULLS LAST;

-- Quarterly statistics
CREATE VIEW v_quarterly_stats AS
SELECT
  pa.year,
  pa.quarter,
  COUNT(*)                                               AS total_applications,
  COUNT(sl.id)                                           AS total_lodged,
  COUNT(cl.id)                                           AS total_client_lodgments,
  COUNT(*) FILTER (WHERE pa.status = 'pending')         AS pending_count,
  COUNT(*) FILTER (WHERE pa.status = 'complete')        AS complete_count,
  COUNT(*) FILTER (WHERE pa.status = 'flagged')         AS flagged_count,
  COUNT(*) FILTER (WHERE pa.status = 'cancelled')       AS cancelled_count,
  COUNT(DISTINCT pa.surveyor_id)                         AS unique_surveyors,
  SUM(pa.fee_paid)                                       AS total_fees_naira
FROM pillar_applications pa
LEFT JOIN surveyor_lodgments sl ON sl.plan_number = pa.plan_number
LEFT JOIN client_lodgments   cl ON cl.plan_number = pa.plan_number
GROUP BY pa.year, pa.quarter
ORDER BY pa.year DESC, pa.quarter DESC;


-- =============================================================================
-- INITIAL SEED: Reference number sequences for current year
-- =============================================================================

INSERT INTO reference_number_sequences (doc_type, year, last_serial)
VALUES
  ('LGC',  EXTRACT(YEAR FROM NOW())::SMALLINT, 0),  -- Lodgement Certificate outer serial
  ('CFC',  EXTRACT(YEAR FROM NOW())::SMALLINT, 0),  -- CFC No. outer serial
  ('CFCP', EXTRACT(YEAR FROM NOW())::SMALLINT, 0),  -- CFC No. PG (inner) serial
  ('CIR',  EXTRACT(YEAR FROM NOW())::SMALLINT, 0),  -- CIR REF No. outer serial
  ('CIRC', EXTRACT(YEAR FROM NOW())::SMALLINT, 0),  -- CIR REF No. C (inner) serial
  ('LDG',  EXTRACT(YEAR FROM NOW())::SMALLINT, 0),  -- Lodgement No.
  ('LND',  EXTRACT(YEAR FROM NOW())::SMALLINT, 0),  -- Land No.
  ('SVY',  EXTRACT(YEAR FROM NOW())::SMALLINT, 0)   -- Survey No.
ON CONFLICT (doc_type, year) DO NOTHING;


-- =============================================================================
-- INITIAL SEED: Default admin account
-- App layer replaces password_hash with bcrypt on first run.
-- =============================================================================






INSERT INTO staff_users (full_name, email, password_hash, role)
VALUES ('SGIS Administrator', 'admin@kwgis.gov.ng', 'CHANGE_ME_ON_FIRST_RUN', 'admin');


INSERT INTO staff_users (full_name, email, password_hash, role)
VALUES ('SGIS Administrator2', 'admin2@kwgis.gov.ng', '$2a$12$iDwmTdKKODcMy7V54H.Q8uu4FhmAHz3MNjBaxjduZSNcgth84H6Ba', 'admin');

-- =============================================================================
-- SCHEMA COMPLETE
-- Tables  : staff_users, surveyors, pillar_applications, pillar_number_registry,
--           surveyor_lodgments, client_lodgments, comparison_results,
--           reference_number_sequences, audit_log, lgas
-- Views   : v_plan_summary, v_pending_applications, v_flagged_plans, v_quarterly_stats
-- Triggers: 5 triggers (updated_at ×4, pillar registration, DB1 status flip)
-- Functions: fn_set_updated_at, fn_register_pillar_numbers,
--            fn_complete_application_on_lodgment, generate_reference_number
-- Ref counters seeded: LGC, CFC, CFCP, CIR, CIRC, LDG, LND, SVY
-- ============================================================================
