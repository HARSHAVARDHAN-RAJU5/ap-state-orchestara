import pool from "../db.js";

export async function execute(context) {

  const { invoice_id, organization_id } = context;

  const stateRes = await pool.query(
    `SELECT review_cycle, last_updated
     FROM invoice_state_machine
     WHERE invoice_id      = $1
       AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  const review_cycle = stateRes.rows[0]?.review_cycle ?? 0;
  const last_updated = stateRes.rows[0]?.last_updated ?? new Date();
  const hoursWaiting = (Date.now() - new Date(last_updated).getTime()) / (1000 * 60 * 60);

  // Build cycle key in JS — never concatenate string + parameter inside SQL
  const cycleKey = `EXCEPTION_REVIEW_CYCLE_${review_cycle}`;

  const autoResolvedRes = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM worker_completion_log
     WHERE invoice_id      = $1
       AND organization_id = $2
       AND state           = $3`,
    [invoice_id, organization_id, cycleKey]
  );

  const alreadyAutoResolved = parseInt(autoResolvedRes.rows[0].cnt, 10) > 0;

  const fraudRes = await pool.query(
    `SELECT risk_score
     FROM invoice_fraud_scores
     WHERE invoice_id      = $1
       AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  const fraudScore    = fraudRes.rows.length ? parseInt(fraudRes.rows[0].risk_score, 10) : null;
  const hasFraudScore = fraudScore !== null;

  // Pick up human decision for THIS cycle only
  const decisionRes = await pool.query(
    `UPDATE exception_review_decisions
     SET processed = true
     WHERE id = (
       SELECT id
       FROM exception_review_decisions
       WHERE invoice_id      = $1
         AND organization_id = $2
         AND processed       = false
         AND review_cycle    = $3
       ORDER BY decided_at DESC
       LIMIT 1
     )
     RETURNING id, decision, reason`,
    [invoice_id, organization_id, review_cycle]
  );

  if (decisionRes.rows.length) {
    return {
      success:             true,
      decisionFound:       true,
      decision:            decisionRes.rows[0].decision,
      decisionId:          decisionRes.rows[0].id,
      reason:              decisionRes.rows[0].reason,
      fraudScore,
      hasFraudScore,
      hoursWaiting,
      alreadyAutoResolved,
      review_cycle
    };
  }

  return {
    success:             true,
    decisionFound:       false,
    fraudScore,
    hasFraudScore,
    hoursWaiting,
    alreadyAutoResolved,
    review_cycle
  };
}

export async function markAutoResolved(invoice_id, organization_id, review_cycle) {
  const cycleKey = `EXCEPTION_REVIEW_CYCLE_${review_cycle}`;
  await pool.query(
    `INSERT INTO worker_completion_log
       (invoice_id, organization_id, state)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [invoice_id, organization_id, cycleKey]
  );
}

export async function escalateApprover(invoice_id, organization_id) {
  await pool.query(
    `UPDATE invoice_approval_workflow
     SET escalated = true
     WHERE invoice_id      = $1
       AND organization_id = $2
       AND approval_status = 'PENDING'`,
    [invoice_id, organization_id]
  );

  await pool.query(
    `INSERT INTO audit_event_log
       (invoice_id, organization_id, old_state, new_state, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [invoice_id, organization_id, "EXCEPTION_REVIEW", "EXCEPTION_REVIEW", "Auto-escalated — SLA wait exceeded"]
  );
}