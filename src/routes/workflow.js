// src/routes/workflow.js
// Client Lodgment — Multi-Department Workflow
//
// GET  /api/workflow/:planNumber              Full workflow state + all stages
// GET  /api/workflow/queue/:role             Department queue — files at your stage
// POST /api/workflow/:planNumber/submit      Submit a stage action (pass/fail/hold)
// GET  /api/workflow/:planNumber/history     Full stage history for a plan
// GET  /api/workflow/stats                   Workflow counts by status (admin/sg_office)

import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Role → stage number mapping — correct 6-stage workflow
const ROLE_STAGES = {
  records:      [1, 6],   // Records opens (1) and closes (6)
  verification: [2, 5],   // Verification does initial review (2) and inspection review (5)
  carto:        [3],      // Cartography does CFC check + charting (3)
  inspection:   [4],      // Inspection does field visit (4)
};

// Roles that can see everything
const FULL_ACCESS_ROLES = ['admin', 'sg_office'];

// ---------------------------------------------------------------------------
// GET /api/workflow/:planNumber
// Full workflow state for a plan — all departments can see this.
// Returns: workflow header + all 5 stage rows + stage definitions.
// ---------------------------------------------------------------------------
router.get('/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    // Get workflow header
    const wfResult = await pool.query(
      `SELECT
         cw.*,
         cl.applicant_name,
         cl.applicant_title,
         cl.applicant_surname,
         cl.applicant_phone,
         cl.applicant_phone2,
         cl.applicant_email,
         cl.lodged_at,
         cl.survey_reason,
         cl.status          AS lodgment_status,
         cl.cfc_no,
         cl.lodgement_no,
         cl.land_no,
         cl.survey_no,
         cl.ref_no,
         cl.ref_number,
         cl.file_number,
         cl.kwirs_receipt_no,
         cl.kwirs_amount,
         cl.kwirs_payment_date
       FROM client_workflows cw
       JOIN client_lodgments cl ON cl.id = cw.client_lodgment_id
       WHERE cw.plan_number = $1`,
      [planNumber]
    );

    if (!wfResult.rows.length) {
      return res.status(404).json({ error: `No workflow found for plan ${planNumber}` });
    }

    const workflow = wfResult.rows[0];

    // Get all stage rows with actioned_by name
    const stagesResult = await pool.query(
      `SELECT
         cws.*,
         su.full_name   AS actioned_by_name,
         su.role        AS actioned_by_role,
         wsd.description AS stage_description
       FROM client_workflow_stages cws
       LEFT JOIN staff_users             su  ON su.id = cws.actioned_by
       LEFT JOIN workflow_stage_definitions wsd ON wsd.stage_number = cws.stage_number
       WHERE cws.workflow_id = $1
       ORDER BY cws.stage_number`,
      [workflow.id]
    );

    // Get linked DB1 and DB2 for context
    const [db1, db2] = await Promise.all([
      pool.query(
        `SELECT pa.*, s.name AS surveyor_name_full, s.phone AS surveyor_phone
         FROM pillar_applications pa
         JOIN surveyors s ON s.id = pa.surveyor_id
         WHERE pa.plan_number = $1`, [planNumber]
      ),
      pool.query(
        'SELECT * FROM surveyor_lodgments WHERE plan_number = $1',
        [planNumber]
      ),
    ]);

    res.json({
      workflow,
      stages:      stagesResult.rows,
      application: db1.rows[0] || null,
      lodgment:    db2.rows[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/workflow/queue/mine
// Returns files currently at the caller's stage(s).
// Each department sees only files waiting for them.
// admin/sg_office see all in-progress files.
// ---------------------------------------------------------------------------
router.get('/queue/mine', requireAuth, async (req, res, next) => {
  try {
    const { role } = req.user;
    const page   = Math.max(1, Number(req.query.page)   || 1);
    const limit  = Math.min(100, Number(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    let rows, countRows;

    if (FULL_ACCESS_ROLES.includes(role)) {
      // Admin / SG Office — see all in-progress workflows
      ({ rows } = await pool.query(
        `SELECT
           cw.plan_number,
           cw.overall_status,
           cw.current_stage,
           cw.last_updated_at,
           cl.applicant_name,
           cl.lodged_at,
           wsd.name        AS current_stage_name,
           wsd.department  AS current_department
         FROM client_workflows cw
         JOIN client_lodgments           cl  ON cl.id = cw.client_lodgment_id
         LEFT JOIN workflow_stage_definitions wsd ON wsd.stage_number = cw.current_stage
         WHERE cw.overall_status IN ('pending','in_progress','on_hold','failed')
         ORDER BY cw.last_updated_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ));
    } else {
      // Department — see only files at their stage(s) and in_progress/on_hold
      const myStages = ROLE_STAGES[role];
      if (!myStages) {
        return res.status(403).json({ error: `Role ${role} has no workflow stage assignment` });
      }

      ({ rows } = await pool.query(
        `SELECT
           cw.plan_number,
           cw.overall_status,
           cw.current_stage,
           cw.last_updated_at,
           cl.applicant_name,
           cl.lodged_at,
           cws.status      AS my_stage_status,
           wsd.name        AS stage_name
         FROM client_workflows cw
         JOIN client_lodgments           cl  ON cl.id = cw.client_lodgment_id
         JOIN client_workflow_stages     cws ON cws.workflow_id = cw.id
           AND cws.stage_number = cw.current_stage
         LEFT JOIN workflow_stage_definitions wsd ON wsd.stage_number = cw.current_stage
         WHERE cw.current_stage = ANY($1::smallint[])
           AND cws.status IN ('in_progress','on_hold')
         ORDER BY cw.last_updated_at ASC
         LIMIT $2 OFFSET $3`,
        [myStages, limit, offset]
      ));
    }

    res.json({ data: rows, total: rows.length, page, limit });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/workflow/:planNumber/submit
// Department submits their stage action.
// Body: { action: 'pass'|'fail'|'hold', stageData: {}, report: string }
//
// Rules:
//  - Can only submit the stage that belongs to your role
//  - That stage must be the current_stage
//  - report is required for both pass and fail
//  - admin/sg_office can submit any stage (override)
// ---------------------------------------------------------------------------
router.post('/:planNumber/submit', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { planNumber }                = req.params;
    const { action, stageData, report } = req.body;
    const { role, id: userId }          = req.user;

    // Validate action
    if (!['pass', 'fail', 'hold'].includes(action)) {
      return res.status(400).json({ error: 'action must be pass, fail, or hold' });
    }

    // Report required on pass and fail
    if ((action === 'pass' || action === 'fail') && !report?.trim()) {
      return res.status(400).json({ error: 'report is required when passing or failing a stage' });
    }

    // Get workflow
    const wfResult = await client.query(
      'SELECT * FROM client_workflows WHERE plan_number = $1',
      [planNumber]
    );
    if (!wfResult.rows.length) {
      return res.status(404).json({ error: `No workflow found for plan ${planNumber}` });
    }

    const workflow    = wfResult.rows[0];
    const stageNumber = workflow.current_stage;

    // Check role
    if (!FULL_ACCESS_ROLES.includes(role)) {
      const myStages = ROLE_STAGES[role] || [];
      if (!myStages.includes(stageNumber)) {
        return res.status(403).json({
          error:         `Your role (${role}) cannot action stage ${stageNumber}`,
          current_stage: stageNumber,
          your_stages:   myStages,
        });
      }
    }

    // Get the current stage row
    const stageResult = await client.query(
      'SELECT * FROM client_workflow_stages WHERE workflow_id = $1 AND stage_number = $2',
      [workflow.id, stageNumber]
    );
    if (!stageResult.rows.length) {
      return res.status(404).json({ error: `Stage ${stageNumber} not found in workflow` });
    }

    const stage = stageResult.rows[0];

    if (!['in_progress', 'on_hold'].includes(stage.status)) {
      return res.status(409).json({
        error: `Stage ${stageNumber} is ${stage.status} — only in_progress or on_hold stages can be submitted`,
      });
    }

    // Build history entry
    const historyEntry = {
      status:      action === 'pass' ? 'passed' : action === 'fail' ? 'failed' : 'on_hold',
      report:      report || null,
      stage_data:  stageData || {},
      actioned_by: userId,
      actioned_at: new Date().toISOString(),
    };

    // Get max stage number
    const maxResult = await client.query(
      'SELECT MAX(stage_number) AS max FROM workflow_stage_definitions WHERE is_active = TRUE'
    );
    const maxStage = Number(maxResult.rows[0].max);

    await client.query('BEGIN');

    // Update the current stage row
    const newStageStatus = action === 'pass' ? 'passed' : action === 'fail' ? 'failed' : 'on_hold';
    await client.query(
      `UPDATE client_workflow_stages
       SET status      = $1,
           stage_data  = $2,
           report      = $3,
           actioned_by = $4,
           actioned_at = NOW(),
           history     = history || $5::jsonb,
           updated_at  = NOW()
       WHERE workflow_id = $6 AND stage_number = $7`,
      [newStageStatus, JSON.stringify(stageData || {}), report || null, userId,
       JSON.stringify([historyEntry]), workflow.id, stageNumber]
    );

    let nextStage      = stageNumber;
    let newWfStatus    = workflow.overall_status;
    let completed      = false;

    if (action === 'pass') {
      if (stageNumber === maxStage) {
        // All stages complete
        newWfStatus = 'complete';
        completed   = true;

        // Mark client lodgment as approved
        await client.query(
          `UPDATE client_lodgments SET status = 'approved', updated_at = NOW()
           WHERE id = $1`,
          [workflow.client_lodgment_id]
        );
      } else {
        // Advance to next stage
        nextStage   = stageNumber + 1;
        newWfStatus = 'in_progress';

        await client.query(
          `UPDATE client_workflow_stages
           SET status = 'in_progress', updated_at = NOW()
           WHERE workflow_id = $1 AND stage_number = $2`,
          [workflow.id, nextStage]
        );
      }
    } else if (action === 'fail') {
      // Reset all OTHER stages to pending
      newWfStatus = 'failed';
      nextStage   = 1;

      await client.query(
        `UPDATE client_workflow_stages
         SET status = 'pending', updated_at = NOW()
         WHERE workflow_id = $1 AND stage_number != $2`,
        [workflow.id, stageNumber]
      );

      // Stage 1 → in_progress
      await client.query(
        `UPDATE client_workflow_stages
         SET status = 'in_progress', updated_at = NOW()
         WHERE workflow_id = $1 AND stage_number = 1`,
        [workflow.id]
      );

      // Mark client lodgment as rejected
      await client.query(
        `UPDATE client_lodgments SET status = 'rejected', updated_at = NOW()
         WHERE id = $1`,
        [workflow.client_lodgment_id]
      );
    } else {
      // hold
      newWfStatus = 'on_hold';
    }

    // Update workflow header
    await client.query(
      `UPDATE client_workflows
       SET current_stage   = $1,
           overall_status  = $2,
           started_at      = COALESCE(started_at, NOW()),
           completed_at    = $3,
           last_updated_at = NOW(),
           last_updated_by = $4
       WHERE id = $5`,
      [nextStage, newWfStatus, completed ? new Date() : null, userId, workflow.id]
    );

    await client.query('COMMIT');

    res.json({
      workflow_id:     workflow.id,
      plan_number:     planNumber,
      stage_number:    stageNumber,
      action,
      new_stage:       nextStage,
      workflow_status: newWfStatus,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// GET /api/workflow/:planNumber/history
// Full submission history for every stage of a plan.
// All roles can see. History is from the JSONB history column.
// ---------------------------------------------------------------------------
router.get('/:planNumber/history', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    const { rows } = await pool.query(
      `SELECT
         cws.stage_number,
         cws.stage_name,
         cws.status,
         cws.report,
         cws.stage_data,
         cws.actioned_at,
         su.full_name  AS actioned_by_name,
         cws.history
       FROM client_workflow_stages cws
       JOIN client_workflows cw ON cw.id = cws.workflow_id
       LEFT JOIN staff_users su ON su.id = cws.actioned_by
       WHERE cw.plan_number = $1
       ORDER BY cws.stage_number`,
      [planNumber]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `No workflow found for plan ${planNumber}` });
    }

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/workflow/stats
// System-wide workflow counts — admin and sg_office only.
// ---------------------------------------------------------------------------
router.get('/stats/overview',
  requireAuth,
  requireRole('admin', 'sg_office'),
  async (_req, res, next) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*)                                                       AS total,
          COUNT(*) FILTER (WHERE overall_status = 'pending')            AS pending,
          COUNT(*) FILTER (WHERE overall_status = 'in_progress')        AS in_progress,
          COUNT(*) FILTER (WHERE overall_status = 'failed')             AS failed,
          COUNT(*) FILTER (WHERE overall_status = 'on_hold')            AS on_hold,
          COUNT(*) FILTER (WHERE overall_status = 'complete')           AS complete,
          COUNT(*) FILTER (WHERE current_stage = 1 AND overall_status = 'in_progress') AS at_stage_1,
          COUNT(*) FILTER (WHERE current_stage = 2 AND overall_status = 'in_progress') AS at_stage_2,
          COUNT(*) FILTER (WHERE current_stage = 3 AND overall_status = 'in_progress') AS at_stage_3,
          COUNT(*) FILTER (WHERE current_stage = 4 AND overall_status = 'in_progress') AS at_stage_4,
          COUNT(*) FILTER (WHERE current_stage = 5 AND overall_status = 'in_progress') AS at_stage_5,
          COUNT(*) FILTER (WHERE current_stage = 6 AND overall_status = 'in_progress') AS at_stage_6
        FROM client_workflows
      `);
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/workflow/stages
// Returns all stage definitions — used by frontend to build forms dynamically.
// ---------------------------------------------------------------------------
router.get('/stages/definitions', requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM workflow_stage_definitions WHERE is_active = TRUE ORDER BY stage_number'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
