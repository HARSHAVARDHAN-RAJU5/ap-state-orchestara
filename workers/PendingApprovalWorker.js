import pool from "../db.js";

export async function execute(context) {

  const { invoice_id, organization_id } = context;

  // Check for a payment approval decision for this invoice
  const decisionRes = await pool.query(
    `UPDATE invoice_payment_approvals
     SET processed = true
     WHERE id = (
       SELECT id
       FROM invoice_payment_approvals
       WHERE invoice_id      = $1
         AND organization_id = $2
         AND processed       = false
       ORDER BY decided_at DESC
       LIMIT 1
     )
     RETURNING id, decision, reason, reviewer_role, reviewer_name`,
    [invoice_id, organization_id]
  );

  if (decisionRes.rows.length) {
    return {
      success:       true,
      decisionFound: true,
      decision:      decisionRes.rows[0].decision,
      decisionId:    decisionRes.rows[0].id,
      reason:        decisionRes.rows[0].reason,
      reviewer_role: decisionRes.rows[0].reviewer_role,
      reviewer_name: decisionRes.rows[0].reviewer_name
    };
  }

  return {
    success:       true,
    decisionFound: false
  };
}