// src/routes/comparison.js
// Phase 6 — Comparison Engine
//
// GET  /api/comparison/:planNumber   Fetch latest stored result (auto-runs if none exists)
// POST /api/comparison/:planNumber   Force fresh comparison engine run
//
// The core runAndStore() function is exported so that lodgments.js and
// clients.js can auto-trigger the engine after every DB2 / DB3 save.

import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ---------------------------------------------------------------------------
// Core comparison engine logic
// Implements all checks from Master Plan Section 7.1
// ---------------------------------------------------------------------------
function runEngine(db1, db2, db3) {
  const checks = [];

  // Helper to push a check result
  const check = (name, flagType, passed, detail) => {
    checks.push({ check: name, flag_type: flagType, passed, detail });
  };

  // --- Missing DB1 (INFO) — standalone lodgment, no pillar application on record ---
  if (!db1) {
    check('missing_db1', 'INFO', false, 'No Pillar Application (DB1) found — standalone lodgment, DB1 cross-checks skipped');
  }

  // --- Missing DB2 (INFO) ---
  if (!db2) {
    check('missing_db2', 'INFO', false, 'No Surveyor Lodgment found — fieldwork not yet lodged');
  }

  // --- Missing DB3 (INFO) ---
  if (!db3) {
    check('missing_db3', 'INFO', false, 'No Client Lodgment found — client has not yet lodged');
  }

  if (db2 && db1) {
    // --- Surveyor mismatch (FLAG) ---
    // SURCON reg numbers must match between DB1 application and DB2 completed plan
    const surveyorMatch = db1.surveyor_reg_no === db2.surveyor_reg_no;
    check(
      'surveyor_mismatch',
      'FLAG',
      surveyorMatch,
      surveyorMatch
        ? 'Surveyor SURCON numbers match'
        : `DB1 reg: ${db1.surveyor_reg_no} ≠ DB2 reg: ${db2.surveyor_reg_no}`
    );

    // --- Pillar count excess (FLAG) ---
    // DB2 used MORE pillars than DB1 issued — impossible without fraud
    const pillarExcess = db2.pillars_used > db1.pillars_requested;
    check(
      'pillar_count_excess',
      'FLAG',
      !pillarExcess,
      pillarExcess
        ? `DB2 used ${db2.pillars_used} pillars but only ${db1.pillars_requested} were issued`
        : `Pillar count within issued limit (${db2.pillars_used}/${db1.pillars_requested})`
    );

    // --- Pillar count reduction (WARN) ---
    // DB2 used FEWER pillars than issued — unaccounted pillars
    const pillarReduction = db2.pillars_used < db1.pillars_requested;
    check(
      'pillar_count_reduction',
      'WARN',
      !pillarReduction,
      pillarReduction
        ? `DB2 used ${db2.pillars_used} pillars — ${db1.pillars_requested - db2.pillars_used} unaccounted`
        : 'All issued pillars accounted for'
    );

    // --- Pillar number mismatch (FLAG) ---
    // Any DB2 pillar number not in DB1 issued list
    const issuedSet      = new Set(db1.pillar_numbers);
    const invalidPillars = db2.pillar_numbers.filter((p) => !issuedSet.has(p));
    check(
      'pillar_number_mismatch',
      'FLAG',
      invalidPillars.length === 0,
      invalidPillars.length === 0
        ? 'All DB2 pillar numbers found in DB1 issued list'
        : `Pillar numbers in DB2 not in DB1: ${invalidPillars.join(', ')}`
    );

    // --- Area discrepancy (FLAG if >5%, WARN if any change) ---
    const estimatedArea = Number(db1.estimated_area_sqm);
    const actualArea    = Number(db2.actual_area_sqm);
    const areaDiffPct   = Math.abs(((actualArea - estimatedArea) / estimatedArea) * 100);

    if (areaDiffPct > 5) {
      check(
        'area_discrepancy',
        'FLAG',
        false,
        `Area difference ${areaDiffPct.toFixed(2)}% exceeds 5% threshold (DB1: ${estimatedArea} sqm → DB2: ${actualArea} sqm)`
      );
    } else if (areaDiffPct > 0) {
      check(
        'area_discrepancy',
        'WARN',
        false,
        `Area changed by ${areaDiffPct.toFixed(2)}% (DB1: ${estimatedArea} sqm → DB2: ${actualArea} sqm)`
      );
    } else {
      check('area_discrepancy', 'WARN', true, `Area unchanged at ${actualArea} sqm`);
    }

    // --- Quarter mismatch (WARN) ---
    const quarterMatch = db1.quarter === db2.quarter;
    check(
      'quarter_mismatch',
      'WARN',
      quarterMatch,
      quarterMatch
        ? `Quarter consistent: ${db1.quarter}`
        : `Application quarter ${db1.quarter} ≠ Lodgment quarter ${db2.quarter}`
    );
  }

  if (db3) {
    // --- Client plan match (FLAG) ---
    // Plan numbers must match exactly across all 3 records
    const planMatch = db1.plan_number === db3.plan_number;
    check(
      'client_plan_match',
      'FLAG',
      planMatch,
      planMatch
        ? `Plan numbers match: ${db1.plan_number}`
        : `DB1 plan: ${db1.plan_number} ≠ DB3 plan: ${db3.plan_number}`
    );

    // --- Incomplete documents (WARN) ---
    const docs = {
      cfc_form:              db3.doc_cfc_form,
      cartographic_report:   db3.doc_cartographic_report,
      inspection_report:     db3.doc_inspection_report,
      identification_report: db3.doc_identification_report,
      lodgement_report:      db3.doc_lodgement_report,
    };
    const missingDocs = Object.entries(docs)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    check(
      'incomplete_documents',
      'WARN',
      missingDocs.length === 0,
      missingDocs.length === 0
        ? 'All 5 required documents received'
        : `Missing documents: ${missingDocs.join(', ')}`
    );
  }

  // --- Determine overall status ---
  const flagCount = checks.filter((c) => c.flag_type === 'FLAG' && !c.passed).length;
  const warnCount = checks.filter((c) => c.flag_type === 'WARN' && !c.passed).length;
  const infoCount = checks.filter((c) => c.flag_type === 'INFO' && !c.passed).length;

  let overallStatus;
  if (!db2 || !db3)       overallStatus = 'incomplete';
  else if (flagCount > 0)  overallStatus = 'flagged';
  else if (warnCount > 0)  overallStatus = 'warning';
  else                     overallStatus = 'clean';

  return { overallStatus, checks, flagCount, warnCount, infoCount };
}

// ---------------------------------------------------------------------------
// runAndStore(planNumber, runBy)
// Core function — exported for use by lodgments.js and clients.js.
// Fetches all 3 DB records, runs the engine, stores the result, and if
// the result is 'flagged' updates DB1 status accordingly.
// Returns the saved comparison_results row.
// ---------------------------------------------------------------------------
export async function runAndStore(planNumber, runBy) {
  const [db1Result, db2Result, db3Result] = await Promise.all([
    pool.query('SELECT * FROM pillar_applications WHERE plan_number = $1', [planNumber]),
    pool.query('SELECT * FROM surveyor_lodgments   WHERE plan_number = $1', [planNumber]),
    pool.query('SELECT * FROM client_lodgments     WHERE plan_number = $1', [planNumber]),
  ]);

  // DB1 is optional — standalone lodgments have no pillar application
  const db1 = db1Result.rows[0] || null;
  const db2 = db2Result.rows[0] || null;
  const db3 = db3Result.rows[0] || null;

  // Need at least one record to run the engine
  if (!db1 && !db2 && !db3) {
    throw Object.assign(new Error(`No records found for plan number ${planNumber}`), { status: 404 });
  }

  const { overallStatus, checks, flagCount, warnCount, infoCount } = runEngine(db1, db2, db3);

  const { rows } = await pool.query(
    `INSERT INTO comparison_results (
       plan_number, application_id, lodgment_id, client_lodgment_id,
       overall_status, checks, flag_count, warn_count, info_count, run_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      planNumber,
      db1?.id || null,
      db2?.id || null,
      db3?.id || null,
      overallStatus,
      JSON.stringify(checks),
      flagCount,
      warnCount,
      infoCount,
      runBy || null,
    ]
  );

  // If flagged, update DB1 status to 'flagged' — only when DB1 exists
  if (overallStatus === 'flagged' && db1) {
    await pool.query(
      `UPDATE pillar_applications
       SET status = 'flagged', updated_at = NOW()
       WHERE plan_number = $1 AND status NOT IN ('cancelled', 'flagged')`,
      [planNumber]
    );
  }

  // If engine result is now clean or warning, and DB1 was previously auto-flagged,
  // restore it to 'complete' so it can proceed — only when DB1 exists
  if (db1 && (overallStatus === 'clean' || overallStatus === 'warning')) {
    await pool.query(
      `UPDATE pillar_applications
       SET status = 'complete', updated_at = NOW()
       WHERE plan_number = $1 AND status = 'flagged'`,
      [planNumber]
    );
  }

  return rows[0];
}

// ---------------------------------------------------------------------------
// GET /api/comparison/:planNumber
// Fetches the latest stored comparison result.
// If no result exists yet, runs the engine automatically.
// ---------------------------------------------------------------------------
router.get('/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;

    // Try latest stored result first
    const existing = await pool.query(
      `SELECT * FROM comparison_results
       WHERE plan_number = $1
       ORDER BY run_at DESC
       LIMIT 1`,
      [planNumber]
    );

    if (existing.rows.length) return res.json(existing.rows[0]);

    // No result yet — run the engine automatically
    const result = await runAndStore(planNumber, null);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/comparison/:planNumber
// Force a fresh comparison engine run (manual trigger by staff).
// Always creates a new result row — full history is preserved.
// ---------------------------------------------------------------------------
router.post('/:planNumber', requireAuth, async (req, res, next) => {
  try {
    const { planNumber } = req.params;
    // runBy is the authenticated user triggering manually
    const result = await runAndStore(planNumber, req.user.id);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

export default router;