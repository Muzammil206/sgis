-- =============================================================================
-- SGIS — 006_client_workflow.sql
-- Full multi-department workflow for Client Lodgments.
-- Flexible stage-based architecture — stages are configurable data,
-- not hardcoded logic.
-- Run after: 005_postgis_geometry.sql
-- =============================================================================

-- =============================================================================
-- PART 1: Extend user_role_enum with department roles
-- =============================================================================

ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'sg_office';
ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'carto';
ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'verification';
ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'inspection';
ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'records';

-- =============================================================================
-- PART 2: Workflow stage status enum
-- =============================================================================

CREATE TYPE workflow_stage_status_enum AS ENUM (
  'pending',      -- Not yet reached
  'in_progress',  -- Current active stage
  'passed',       -- Completed and approved
  'failed',       -- Failed — process stopped, corrections needed
  'on_hold'       -- Temporarily paused by staff
);

-- =============================================================================
-- PART 3: Overall client lodgment workflow status enum
-- =============================================================================

CREATE TYPE workflow_status_enum AS ENUM (
  'pending',    -- Just created, not yet started
  'in_progress',-- Moving through stages
  'failed',     -- Stopped at a stage — corrections needed
  'on_hold',    -- Paused
  'complete'    -- All stages passed — CIR can be generated
);

-- =============================================================================
-- PART 4: workflow_stage_definitions
-- Master config table for all stages.
-- Flexible — add/reorder/rename stages without changing code.
-- =============================================================================

CREATE TABLE workflow_stage_definitions (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  stage_number    SMALLINT      NOT NULL UNIQUE,  -- 1,2,3,4,5
  name            VARCHAR(100)  NOT NULL,          -- Display name
  department      VARCHAR(50)   NOT NULL,          -- Matches role name e.g. 'carto'
  description     TEXT          NOT NULL,
  required_role   user_role_enum NOT NULL,         -- Which role can action this stage
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workflow_stage_definitions IS
  'Master config for workflow stages. Flexible — add or modify stages without code changes.';

-- Seed the 5 stages
INSERT INTO workflow_stage_definitions
  (stage_number, name, department, description, required_role)
VALUES
  (1, 'Charting for Confirmation',  'carto',        'Cartography department checks if the plan is free from government acquisition and existing titles. Produces the CFC check result.', 'carto'),
  (2, 'Cartographic Form',          'carto',        'Cartography department fills the full cartographic data — beacon number, coordinates, size, CFC number, and charting date.', 'carto'),
  (3, 'Verification',               'verification', 'Verification department reviews all plan information — surveyor details, measurements, documents — and submits a formal verification report.', 'verification'),
  (4, 'Inspection',                 'inspection',   'Inspection department conducts a field visit to the site and submits a physical inspection report.', 'inspection'),
  (5, 'Records',                    'records',      'Records department performs final record keeping, files all documents, and closes the workflow. This triggers CIR generation.', 'records');

-- =============================================================================
-- PART 5: client_workflows
-- One row per client lodgment — tracks the overall workflow state.
-- =============================================================================

CREATE TABLE client_workflows (
  id                  UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_lodgment_id  UUID                    NOT NULL UNIQUE REFERENCES client_lodgments(id),
  plan_number         VARCHAR(40)             NOT NULL,

  -- Current position
  current_stage       SMALLINT                NOT NULL DEFAULT 1,
  overall_status      workflow_status_enum    NOT NULL DEFAULT 'pending',

  -- Timestamps
  started_at          TIMESTAMPTZ,            -- When stage 1 was first actioned
  completed_at        TIMESTAMPTZ,            -- When stage 5 passed
  last_updated_at     TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

  -- Who last touched this workflow
  last_updated_by     UUID                    REFERENCES staff_users(id),

  created_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE client_workflows IS
  'One row per client lodgment. Tracks current stage and overall workflow status.';

CREATE INDEX idx_cw_client_lodgment  ON client_workflows (client_lodgment_id);
CREATE INDEX idx_cw_plan_number      ON client_workflows (plan_number);
CREATE INDEX idx_cw_overall_status   ON client_workflows (overall_status);
CREATE INDEX idx_cw_current_stage    ON client_workflows (current_stage);

-- =============================================================================
-- PART 6: client_workflow_stages
-- One row per stage per workflow — tracks each stage's status and data.
-- Pre-populated for all 5 stages when workflow is created.
-- =============================================================================

CREATE TABLE client_workflow_stages (
  id              UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id     UUID                        NOT NULL REFERENCES client_workflows(id),
  stage_number    SMALLINT                    NOT NULL,
  stage_name      VARCHAR(100)                NOT NULL,
  required_role   user_role_enum              NOT NULL,

  -- Status
  status          workflow_stage_status_enum  NOT NULL DEFAULT 'pending',

  -- Stage data — each department fills in their fields here as JSONB.
  -- Flexible: no schema change needed when stage fields change.
  stage_data      JSONB                       NOT NULL DEFAULT '{}',

  -- Report / comment (required on both pass and fail)
  report          TEXT,

  -- Audit
  actioned_by     UUID                        REFERENCES staff_users(id),
  actioned_at     TIMESTAMPTZ,

  -- History — every previous submission for this stage is preserved
  history         JSONB                       NOT NULL DEFAULT '[]',
  -- history format: [{status, report, stage_data, actioned_by, actioned_at}]

  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),

  UNIQUE (workflow_id, stage_number)
);

COMMENT ON TABLE client_workflow_stages IS
  'One row per stage per workflow. Stage-specific data stored as JSONB for flexibility.
   History array preserves all previous submissions for audit trail.';

CREATE INDEX idx_cws_workflow_id   ON client_workflow_stages (workflow_id);
CREATE INDEX idx_cws_stage_number  ON client_workflow_stages (stage_number);
CREATE INDEX idx_cws_status        ON client_workflow_stages (status);

-- =============================================================================
-- PART 7: JSONB field schemas per stage (documentation — not enforced by DB)
-- Stage 1 — Charting for Confirmation (carto)
-- {
--   in_govt_acquisition: boolean,
--   in_govt_acquisition_remarks: string,
--   within_existing_title: boolean,
--   within_existing_title_remarks: string,
--   free_from_acquisition: boolean,
--   free_from_acquisition_remarks: string
-- }
--
-- Stage 2 — Cartographic Form (carto)
-- {
--   beacon_no: string,
--   cfc_no: string,
--   utm_northing: string,
--   utm_easting: string,
--   township_northing: string,
--   township_easting: string,
--   size_sqm: number,
--   charting_date: date string,
--   doc_cfc_form: boolean,
--   doc_cartographic_report: boolean,
--   doc_inspection_report: boolean,
--   doc_identification_report: boolean,
--   doc_lodgement_report: boolean
-- }
--
-- Stage 3 — Verification
-- {
--   surveyor_details_verified: boolean,
--   measurements_verified: boolean,
--   documents_verified: boolean,
--   plan_number_verified: boolean,
--   verification_report: string
-- }
--
-- Stage 4 — Inspection
-- {
--   site_visited: boolean,
--   site_visit_date: date string,
--   beacons_found: boolean,
--   beacons_condition: string,
--   site_matches_plan: boolean,
--   inspection_report: string,
--   inspector_name: string
-- }
--
-- Stage 5 — Records
-- {
--   file_number: string,
--   cabinet_reference: string,
--   documents_filed: boolean,
--   records_report: string
-- }
-- =============================================================================

-- =============================================================================
-- PART 8: Function — initialise workflow for a client lodgment
-- Creates the client_workflows row + 5 client_workflow_stages rows.
-- Called by the backend when a client lodgment is created.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_init_client_workflow(
  p_client_lodgment_id UUID,
  p_plan_number        VARCHAR
)
RETURNS UUID AS $$
DECLARE
  v_workflow_id UUID;
  v_stage       RECORD;
BEGIN
  -- Create the workflow header
  INSERT INTO client_workflows (client_lodgment_id, plan_number, current_stage, overall_status)
  VALUES (p_client_lodgment_id, p_plan_number, 1, 'pending'::workflow_status_enum)
  RETURNING id INTO v_workflow_id;

  -- Pre-create a row for every active stage
  FOR v_stage IN
    SELECT stage_number, name, required_role
    FROM   workflow_stage_definitions
    WHERE  is_active = TRUE
    ORDER  BY stage_number
  LOOP
    INSERT INTO client_workflow_stages
      (workflow_id, stage_number, stage_name, required_role, status)
    VALUES
      (v_workflow_id, v_stage.stage_number, v_stage.name, v_stage.required_role,
       CASE WHEN v_stage.stage_number = 1
         THEN 'in_progress'::workflow_stage_status_enum
         ELSE 'pending'::workflow_stage_status_enum
       END);
  END LOOP;

  RETURN v_workflow_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_init_client_workflow IS
  'Creates a client_workflows record and pre-populates all 5 stage rows. Call after inserting a client_lodgment.';

-- =============================================================================
-- PART 9: Function — advance or fail a workflow stage
-- Called by the backend when a department submits their stage action.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_submit_workflow_stage(
  p_workflow_id   UUID,
  p_stage_number  SMALLINT,
  p_action        VARCHAR,    -- 'pass' | 'fail' | 'hold'
  p_stage_data    JSONB,
  p_report        TEXT,
  p_actioned_by   UUID
)
RETURNS JSONB AS $$
DECLARE
  v_workflow      RECORD;
  v_stage         RECORD;
  v_next_stage    SMALLINT;
  v_max_stage     SMALLINT;
  v_new_status    workflow_stage_status_enum;
  v_wf_status     workflow_status_enum;
  v_history_entry JSONB;
BEGIN
  -- Load current workflow
  SELECT * INTO v_workflow FROM client_workflows WHERE id = p_workflow_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow % not found', p_workflow_id;
  END IF;

  -- Load the stage
  SELECT * INTO v_stage FROM client_workflow_stages
  WHERE workflow_id = p_workflow_id AND stage_number = p_stage_number FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage % not found in workflow %', p_stage_number, p_workflow_id;
  END IF;

  -- Stage must be in_progress or on_hold to accept a submission
  IF v_stage.status NOT IN ('in_progress', 'on_hold') THEN
    RAISE EXCEPTION 'Stage % is % — cannot submit. Only in_progress or on_hold stages accept submissions.',
      p_stage_number, v_stage.status;
  END IF;

  -- Must be the current stage
  IF v_workflow.current_stage != p_stage_number THEN
    RAISE EXCEPTION 'Stage % is not the current active stage (current: %)', p_stage_number, v_workflow.current_stage;
  END IF;

  -- Determine new stage status
  v_new_status := CASE p_action
    WHEN 'pass' THEN 'passed'::workflow_stage_status_enum
    WHEN 'fail' THEN 'failed'::workflow_stage_status_enum
    WHEN 'hold' THEN 'on_hold'::workflow_stage_status_enum
    ELSE RAISE EXCEPTION 'Invalid action %. Must be pass, fail, or hold.', p_action
  END;

  -- Build history entry
  v_history_entry := jsonb_build_object(
    'status',       v_new_status,
    'report',       p_report,
    'stage_data',   p_stage_data,
    'actioned_by',  p_actioned_by,
    'actioned_at',  NOW()
  );

  -- Update the stage row
  UPDATE client_workflow_stages SET
    status       = v_new_status,
    stage_data   = p_stage_data,
    report       = p_report,
    actioned_by  = p_actioned_by,
    actioned_at  = NOW(),
    history      = history || v_history_entry,
    updated_at   = NOW()
  WHERE workflow_id = p_workflow_id AND stage_number = p_stage_number;

  -- Get max stage number
  SELECT MAX(stage_number) INTO v_max_stage FROM workflow_stage_definitions WHERE is_active = TRUE;

  -- Determine next workflow state
  IF p_action = 'pass' THEN
    IF p_stage_number = v_max_stage THEN
      -- All stages complete
      v_wf_status  := 'complete'::workflow_status_enum;
      v_next_stage := p_stage_number;

      -- Update client_lodgments status to 'approved'
      UPDATE client_lodgments SET status = 'approved'::lodgment_status_enum, updated_at = NOW()
      WHERE id = v_workflow.client_lodgment_id;

    ELSE
      -- Advance to next stage
      v_next_stage := p_stage_number + 1;
      v_wf_status  := 'in_progress'::workflow_status_enum;

      -- Activate the next stage
      UPDATE client_workflow_stages SET
        status     = 'in_progress'::workflow_stage_status_enum,
        updated_at = NOW()
      WHERE workflow_id = p_workflow_id AND stage_number = v_next_stage;
    END IF;

  ELSIF p_action = 'fail' THEN
    -- Process stops. Reset all subsequent stages to pending.
    -- Previous passed stages keep their data but are reset to pending for re-review.
    v_wf_status  := 'failed'::workflow_status_enum;
    v_next_stage := 1;  -- Goes back to stage 1

    -- Reset all stages to pending (preserving history)
    UPDATE client_workflow_stages SET
      status     = 'pending'::workflow_stage_status_enum,
      updated_at = NOW()
    WHERE workflow_id = p_workflow_id
      AND stage_number != p_stage_number;  -- Don't touch the failed stage itself

    -- Stage 1 becomes in_progress again
    UPDATE client_workflow_stages SET
      status     = 'in_progress'::workflow_stage_status_enum,
      updated_at = NOW()
    WHERE workflow_id = p_workflow_id AND stage_number = 1;

    -- Update client_lodgments status to 'rejected'
    UPDATE client_lodgments SET status = 'rejected'::lodgment_status_enum, updated_at = NOW()
    WHERE id = v_workflow.client_lodgment_id;

  ELSIF p_action = 'hold' THEN
    v_wf_status  := 'on_hold'::workflow_status_enum;
    v_next_stage := p_stage_number;
  END IF;

  -- Update workflow header
  UPDATE client_workflows SET
    current_stage   = v_next_stage,
    overall_status  = v_wf_status,
    started_at      = COALESCE(started_at, NOW()),
    completed_at    = CASE WHEN v_wf_status = 'complete' THEN NOW() ELSE NULL END,
    last_updated_at = NOW(),
    last_updated_by = p_actioned_by
  WHERE id = p_workflow_id;

  RETURN jsonb_build_object(
    'workflow_id',    p_workflow_id,
    'stage_number',   p_stage_number,
    'action',         p_action,
    'new_stage',      v_next_stage,
    'workflow_status',v_wf_status
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_submit_workflow_stage IS
  'Processes a department stage submission. Advances on pass, stops and resets on fail, holds in place on hold.';

-- =============================================================================
-- PART 10: updated_at trigger for client_workflow_stages
-- =============================================================================

CREATE TRIGGER trg_updated_at_client_workflow_stages
  BEFORE UPDATE ON client_workflow_stages
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =============================================================================
-- PART 11: View — full workflow progress per plan
-- =============================================================================

CREATE VIEW v_client_workflow_progress AS
SELECT
  cl.plan_number,
  cl.applicant_name,
  cl.lodged_at,
  cl.status                   AS lodgment_status,
  cw.id                       AS workflow_id,
  cw.overall_status           AS workflow_status,
  cw.current_stage,
  cw.started_at,
  cw.completed_at,
  cw.last_updated_at,
  -- Stage summaries as a JSONB array
  jsonb_agg(
    jsonb_build_object(
      'stage_number', cws.stage_number,
      'stage_name',   cws.stage_name,
      'status',       cws.status,
      'actioned_by',  su.full_name,
      'actioned_at',  cws.actioned_at,
      'report',       cws.report
    ) ORDER BY cws.stage_number
  ) AS stages
FROM client_lodgments       cl
JOIN client_workflows       cw  ON cw.client_lodgment_id = cl.id
JOIN client_workflow_stages cws ON cws.workflow_id = cw.id
LEFT JOIN staff_users       su  ON su.id = cws.actioned_by
GROUP BY cl.plan_number, cl.applicant_name, cl.lodged_at, cl.status,
         cw.id, cw.overall_status, cw.current_stage,
         cw.started_at, cw.completed_at, cw.last_updated_at;

COMMENT ON VIEW v_client_workflow_progress IS
  'Full workflow progress per client lodgment with all stage summaries as a JSONB array.';

-- =============================================================================
-- PART 12: Backfill — create workflows for any existing client lodgments
-- =============================================================================

DO $$
DECLARE
  v_rec RECORD;
  v_count INT := 0;
BEGIN
  FOR v_rec IN
    SELECT cl.id, cl.plan_number
    FROM   client_lodgments cl
    WHERE  NOT EXISTS (
      SELECT 1 FROM client_workflows cw WHERE cw.client_lodgment_id = cl.id
    )
  LOOP
    PERFORM fn_init_client_workflow(v_rec.id, v_rec.plan_number);
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfilled % existing client lodgments with workflow records', v_count;
END;
$$;

-- =============================================================================
-- MIGRATION COMPLETE
-- New tables : workflow_stage_definitions (5 stages seeded)
--              client_workflows
--              client_workflow_stages
-- New enums  : workflow_stage_status_enum, workflow_status_enum
-- New roles  : sg_office, carto, verification, inspection, records
-- New view   : v_client_workflow_progress
-- New funcs  : fn_init_client_workflow, fn_submit_workflow_stage
-- =============================================================================
