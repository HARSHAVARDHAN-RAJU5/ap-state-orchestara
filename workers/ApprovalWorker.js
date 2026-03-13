import pool from "../db.js";

export async function execute(context) {

  const { invoice_id, organization_id, config } = context;

  if (!invoice_id || !organization_id) {
    return { success: false, reason: "Missing invoice context" };
  }

  if (!config?.approval) {
    return { success: false, reason: "Approval configuration missing" };
  }

  // Validate current state
  const stateCheck = await pool.query(
    `
    SELECT current_state
    FROM invoice_state_machine
    WHERE invoice_id = $1
      AND organization_id = $2
    `,
    [invoice_id, organization_id]
  );

  if (!stateCheck.rows.length) {
    return { success: false, reason: "State record not found" };
  }

  if (stateCheck.rows[0].current_state !== "PENDING_APPROVAL") {
    return { success: false, reason: "Invalid state for approval routing" };
  }

  // Fetch invoice financial data
  const invoiceRes = await pool.query(
    `
    SELECT data
    FROM invoice_extracted_data
    WHERE invoice_id = $1
      AND organization_id = $2
    `,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, reason: "Invoice data not found" };
  }

  const invoiceData = invoiceRes.rows[0].data || {};
  const invoiceTotal = parseFloat(invoiceData.total_amount || 0);

  if (!invoiceTotal) {
    return { success: false, reason: "Invoice total missing" };
  }

  // Determine approval level from config
  let approvalLevel = "LEVEL_1";

  if (invoiceTotal >= config.approval.high_value_threshold) {
    approvalLevel = "LEVEL_3";
  } else if (invoiceTotal >= config.approval.mid_value_threshold) {
    approvalLevel = "LEVEL_2";
  }

  // Record approval routing
  await pool.query(
    `
    INSERT INTO invoice_approval_workflow
      (invoice_id, organization_id,
       assigned_to, approval_level,
       approval_status, created_at)
    VALUES ($1,$2,$3,$4,$5,NOW())
    ON CONFLICT (invoice_id, organization_id)
    DO UPDATE SET
      assigned_to = EXCLUDED.assigned_to,
      approval_level = EXCLUDED.approval_level,
      approval_status = EXCLUDED.approval_status
    `,
    [
      invoice_id,
      organization_id,
      approvalLevel,
      approvalLevel,
      "PENDING"
    ]
  );

  return {
    success: true,
    approval_level: approvalLevel
  };
}