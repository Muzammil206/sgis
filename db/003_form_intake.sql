-- =============================================================================
-- SGIS — 003_form_intake.sql
-- Google Form approved submission intake pipeline
--
-- Run after 001_schema.sql and 002_seed_surveyors.sql:
--   psql -U postgres -d sgis -f db/003_form_intake.sql
-- =============================================================================


-- ---------------------------------------------------------------------------
-- STAGING TABLE
-- Every inbound approved submission lands here first.
-- Acts as: audit log, idempotency guard, retry safety net.
-- Only the fields we actually send from Apps Script are stored.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS form_intake_staging (
  id                      UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Unique identity — prevents double-processing on retry
  plan_number             VARCHAR(40)   NOT NULL UNIQUE,

  -- Fields received from Apps Script (trimmed set)
  timestamp_submitted     TIMESTAMPTZ,
  surveyor_raw            TEXT          NOT NULL,   -- e.g. "SURV. BODUNDE A. FRANCIS (4830) (BF)"
  year                    SMALLINT,
  quarter_raw             TEXT,                     -- e.g. "First Quarter (January - March)"
  location_address        TEXT,
  lga                     VARCHAR(100),
  survey_request          TEXT,                     -- e.g. "Regular"
  amount_surcon           NUMERIC(12,2),
  amount_mds              NUMERIC(12,2),
  date_of_payment         DATE,
  number_of_pillars       SMALLINT,
  pillar_series           VARCHAR(10),              -- e.g. "L"
  pillar_start            INTEGER,                  -- e.g. 3366
  pillar_end              INTEGER,                  -- e.g. 3369
  survey_plan_url         TEXT,
  nis_clearance_url       TEXT,
  surcon_payment_url      TEXT,
  dwg_autocad_url         TEXT,
  mds_payment_url         TEXT,
  resident_status         TEXT,
  sheet_status            VARCHAR(50),              -- "Approved" always (we only accept Approved)

  -- Full raw payload backup — never mutated, audit trail
  raw_payload             JSONB         NOT NULL,

  -- Processing state
  processing_status       VARCHAR(20)   NOT NULL DEFAULT 'received'
                            CHECK (processing_status IN ('received','promoted','failed','duplicate')),
  processing_error        TEXT,
  promoted_application_id UUID,                    -- set after successful promotion
  processed_at            TIMESTAMPTZ,

  -- Webhook metadata
  received_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  webhook_source          TEXT          NOT NULL DEFAULT 'google_form'
);

COMMENT ON TABLE  form_intake_staging IS
  'Landing zone for all approved Google Form submissions. '
  'Rows promoted to pillar_applications once surveyor is resolved and pillar array built. '
  'Full raw_payload preserved forever for audit.';

COMMENT ON COLUMN form_intake_staging.pillar_series IS
  'Used with pillar_start + pillar_end to generate the pillar_numbers array on promotion. '
  'e.g. series=L, start=3366, end=3369 → ["L3366","L3367","L3368","L3369"]';

COMMENT ON COLUMN form_intake_staging.promoted_application_id IS
  'FK to pillar_applications.id — set when processing_status = promoted.';

CREATE INDEX IF NOT EXISTS idx_fis_plan_number       ON form_intake_staging (plan_number);
CREATE INDEX IF NOT EXISTS idx_fis_processing_status ON form_intake_staging (processing_status);
CREATE INDEX IF NOT EXISTS idx_fis_received_at       ON form_intake_staging (received_at DESC);


-- ---------------------------------------------------------------------------
-- SYSTEM SERVICE ACCOUNT
-- Used as entered_by for all form-originated pillar_applications records.
-- The password_hash is intentionally invalid — this account cannot log in.
-- ---------------------------------------------------------------------------

INSERT INTO staff_users (id, full_name, email, password_hash, role, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Google Form Intake (System)',
  'form-intake@sgis.internal',
  '$2b$12$SYSTEM_CANNOT_LOGIN_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'staff',
  TRUE
)
ON CONFLICT (email) DO NOTHING;


-- ---------------------------------------------------------------------------
-- EXTEND pillar_applications
-- Add columns that come from the form but have no existing equivalent.
-- All nullable — manual entries (entered via the frontend) leave them NULL.
-- ---------------------------------------------------------------------------

ALTER TABLE pillar_applications
  ADD COLUMN IF NOT EXISTS source              VARCHAR(20)  DEFAULT 'manual'
                              CHECK (source IN ('manual', 'google_form')),
  ADD COLUMN IF NOT EXISTS intake_staging_id   UUID         REFERENCES form_intake_staging(id),
  ADD COLUMN IF NOT EXISTS survey_plan_url     TEXT,
  ADD COLUMN IF NOT EXISTS nis_clearance_url   TEXT,
  ADD COLUMN IF NOT EXISTS surcon_payment_url  TEXT,
  ADD COLUMN IF NOT EXISTS dwg_autocad_url     TEXT,
  ADD COLUMN IF NOT EXISTS mds_payment_url     TEXT,
  ADD COLUMN IF NOT EXISTS survey_request_type TEXT,
  ADD COLUMN IF NOT EXISTS resident_status     TEXT,
  ADD COLUMN IF NOT EXISTS amount_mds          NUMERIC(12,2);

COMMENT ON COLUMN pillar_applications.source IS
  'manual = entered via SGIS frontend | google_form = promoted from form_intake_staging';

COMMENT ON COLUMN pillar_applications.intake_staging_id IS
  'Link back to the staging row this application was promoted from. NULL for manual entries.';

COMMENT ON COLUMN pillar_applications.survey_plan_url IS
  'Google Drive link to the Survey Plan (Map) uploaded by the surveyor via Google Form.';