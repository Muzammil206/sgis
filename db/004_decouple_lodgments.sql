-- =============================================================================
-- Migration 004: Decouple DB2, DB3, and comparison_results from DB1
-- =============================================================================
-- The business requirement: surveyors can lodge old plans that were never
-- digitized into DB1 (Pillar Applications). The system should accept
-- standalone lodgments and flag them as such, rather than blocking entry.
--
-- What this migration does:
--   1. Drops the FOREIGN KEY constraints that force plan_number / application_id
--      to reference pillar_applications in surveyor_lodgments, client_lodgments,
--      and comparison_results.
--   2. Keeps application_id columns but makes them nullable.
--   3. Adds an is_standalone computed column to DB2 and DB3 for easy reporting.
--   4. Does NOT drop any data — safe to run on a live database.
--
-- Run once:
--   psql -U your_user -d your_db -f 004_decouple_lodgments.sql
-- =============================================================================

BEGIN;

-- ── surveyor_lodgments ──────────────────────────────────────────────────────

-- 1. Drop FK on plan_number → pillar_applications.plan_number
ALTER TABLE surveyor_lodgments
  DROP CONSTRAINT IF EXISTS surveyor_lodgments_plan_number_fkey;

-- 2. Drop FK on application_id → pillar_applications.id
ALTER TABLE surveyor_lodgments
  DROP CONSTRAINT IF EXISTS surveyor_lodgments_application_id_fkey;

-- 3. Make application_id nullable
ALTER TABLE surveyor_lodgments
  ALTER COLUMN application_id DROP NOT NULL;

-- 4. Add standalone flag (true = no matching DB1)
-- Note: is_standalone is a GENERATED ALWAYS column, so no manual update needed
ALTER TABLE surveyor_lodgments
  ADD COLUMN IF NOT EXISTS is_standalone BOOLEAN GENERATED ALWAYS AS (application_id IS NULL) STORED;

-- ── client_lodgments ────────────────────────────────────────────────────────

-- 6. Drop FK on plan_number → pillar_applications.plan_number
ALTER TABLE client_lodgments
  DROP CONSTRAINT IF EXISTS client_lodgments_plan_number_fkey;

-- 7. Drop FK on application_id → pillar_applications.id
ALTER TABLE client_lodgments
  DROP CONSTRAINT IF EXISTS client_lodgments_application_id_fkey;

-- 8. Make application_id nullable
ALTER TABLE client_lodgments
  ALTER COLUMN application_id DROP NOT NULL;

-- 9. Add standalone flag
-- Note: is_standalone is a GENERATED ALWAYS column, so no manual update needed
ALTER TABLE client_lodgments
  ADD COLUMN IF NOT EXISTS is_standalone BOOLEAN GENERATED ALWAYS AS (application_id IS NULL) STORED;

-- ── comparison_results ──────────────────────────────────────────────────────

-- 11. Drop FK on plan_number → pillar_applications.plan_number
ALTER TABLE comparison_results
  DROP CONSTRAINT IF EXISTS comparison_results_plan_number_fkey;

-- 12. Drop FK on application_id → pillar_applications.id
ALTER TABLE comparison_results
  DROP CONSTRAINT IF EXISTS comparison_results_application_id_fkey;

-- 13. Make application_id nullable
ALTER TABLE comparison_results
  ALTER COLUMN application_id DROP NOT NULL;

-- ── Indexes for standalone filtering ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sl_standalone ON surveyor_lodgments (is_standalone) WHERE is_standalone = TRUE;
CREATE INDEX IF NOT EXISTS idx_cl_standalone ON client_lodgments   (is_standalone) WHERE is_standalone = TRUE;

COMMIT;