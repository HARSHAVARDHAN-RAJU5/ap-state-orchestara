import pool from "../db.js";

export async function execute(context) {

  const { invoice_id, organization_id } = context;

  // Check for pending human decision
  const decisionRes = await pool.query(
    `SELECT id, decision, reason
     FROM exception_review_decisions
     WHERE invoice_id = $1
       AND organization_id = $2
       AND processed = false
     ORDER BY decided_at DESC
     LIMIT 1`,
    [invoice_id, organization_id]
  );

  // Fetch fraud score if exists
  const fraudRes = await pool.query(
    `SELECT risk_score, signals
     FROM invoice_fraud_scores
     WHERE invoice_id = $1
       AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  // Fetch how long invoice has been in EXCEPTION_REVIEW
  const stateRes = await pool.query(
    `SELECT last_updated
     FROM invoice_state_machine
     WHERE invoice_id = $1
       AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  const hoursWaiting = stateRes.rows.length
    ? (Date.now() - new Date(stateRes.rows[0].last_updated).getTime()) / (1000 * 60 * 60)
    : 0;

  const fraudScore  = fraudRes.rows.length ? parseInt(fraudRes.rows[0].risk_score, 10) : null;
  const hasFraudScore = fraudScore !== null;

  if (decisionRes.rows.length) {
    return {
      success: true,
      decisionFound: true,
      decision:   decisionRes.rows[0].decision,
      decisionId: decisionRes.rows[0].id,
      reason:     decisionRes.rows[0].reason,
      fraudScore,
      hasFraudScore,
      hoursWaiting
    };
  }

  return {
    success: true,
    decisionFound: false,
    fraudScore,
    hasFraudScore,
    hoursWaiting
  };
}

export async function markDecisionProcessed(decisionId, organization_id) {
  await pool.query(
    `UPDATE exception_review_decisions
     SET processed = true
     WHERE id = $1 AND organization_id = $2`,
    [decisionId, organization_id]
  );
}

export async function escalateApprover(invoice_id, organization_id) {
  await pool.query(
    `UPDATE invoice_approval_workflow
     SET escalated = true
     WHERE invoice_id = $1
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