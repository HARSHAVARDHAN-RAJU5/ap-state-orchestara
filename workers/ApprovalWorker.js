import pool from "../db.js";

export async function execute(context) {

  const { invoice_id, organization_id, config } = context;

  if (!invoice_id || !organization_id) {
    return { success: false, reason: "Missing invoice context" };
  }

  if (!config?.approval?.levels?.length) {
    return { success: false, reason: "Approval levels not configured" };
  }

  // fetch invoice amount
  const invoiceRes = await pool.query(
    `SELECT data
     FROM invoice_extracted_data
     WHERE invoice_id = $1
     AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, reason: "Invoice data not found" };
  }

  const invoiceTotal = parseFloat(
    invoiceRes.rows[0].data?.total_amount || 0
  );

  if (!invoiceTotal) {
    return { success: false, reason: "Invoice total missing" };
  }

  // match invoice amount to correct approval tier
  const levels = [...config.approval.levels]
    .sort((a, b) => b.min_amount - a.min_amount);

  const matched = levels.find(l => invoiceTotal >= l.min_amount);

  if (!matched) {
    return { success: false, reason: "No matching approval tier found" };
  }

  const required_approval_level = matched.approver_role;

  // store in workflow table
  await pool.query(
    `INSERT INTO invoice_approval_workflow
      (invoice_id, organization_id, approval_level,
       required_approval_level, approval_status, created_at)
    VALUES ($1, $2, $3, $4, 'PENDING', NOW())
    ON CONFLICT (invoice_id, organization_id)
    DO UPDATE SET
      approval_level = EXCLUDED.approval_level,
      required_approval_level = EXCLUDED.required_approval_level,
      approval_status = EXCLUDED.approval_status`,
    [
      invoice_id,
      organization_id,
      required_approval_level,
      required_approval_level
    ]
  );

  return {
    success: true,
    required_approval_level
  };
}