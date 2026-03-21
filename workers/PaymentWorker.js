import pool from "../db.js";
import { isAlreadyDone, markDone } from "../core/workerIdempotency.js";

function calculateDueDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days));
  return date;
}

export async function execute(context) {

  const { invoice_id, organization_id, config } = context;

  if (!invoice_id || !organization_id) {
    return { success: false, reason: "Missing invoice context" };
  }

  // Clear idempotency so PaymentWorker always reruns fresh.
  // Invoice can reach PAYMENT_READY multiple times (normal path + exception resolve path).
  // Each time it must reschedule payment and reset the approval workflow.
  await pool.query(
    `DELETE FROM worker_completion_log
     WHERE invoice_id      = $1
       AND organization_id = $2
       AND state           = 'PAYMENT_READY'`,
    [invoice_id, organization_id]
  );

  const stateRes = await pool.query(
    `SELECT current_state
     FROM invoice_state_machine
     WHERE invoice_id      = $1
       AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!stateRes.rows.length) {
    return { success: false, reason: "State record not found" };
  }

  if (stateRes.rows[0].current_state !== "PAYMENT_READY") {
    return { success: false, reason: "Invalid state for payment scheduling" };
  }

  const invoiceRes = await pool.query(
    `SELECT data
     FROM invoice_extracted_data
     WHERE invoice_id      = $1
       AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, reason: "Invoice data not found" };
  }

  const invoice       = invoiceRes.rows[0].data || {};
  const paymentPolicy = config?.payment || {};

  let dueDate;

  if (invoice?.due_date) {
    dueDate = new Date(invoice.due_date);
  } else if (paymentPolicy?.default_due_days) {
    dueDate = calculateDueDate(paymentPolicy.default_due_days);
  } else {
    return { success: false, reason: "Payment due date missing" };
  }

  const paymentMethod =
    invoice?.payment_method ||
    paymentPolicy?.default_payment_method ||
    "BANK_TRANSFER";

  await pool.query(
    `INSERT INTO invoice_payment_schedule
      (invoice_id, organization_id,
       payment_status, payment_due_date,
       payment_method, scheduled_at)
    VALUES ($1,$2,$3,$4,$5,NOW())
    ON CONFLICT (invoice_id, organization_id)
    DO UPDATE SET
      payment_status   = EXCLUDED.payment_status,
      payment_due_date = EXCLUDED.payment_due_date,
      payment_method   = EXCLUDED.payment_method`,
    [invoice_id, organization_id, "SCHEDULED", dueDate, paymentMethod]
  );

  if (!config?.approval?.levels?.length) {
    return { success: false, reason: "Approval levels not configured" };
  }

  const invoiceTotal   = parseFloat(invoice.total_amount || 0);
  const levels         = [...config.approval.levels].sort((a, b) => b.min_amount - a.min_amount);
  const matched        = levels.find(l => invoiceTotal >= l.min_amount);
  const required_level = matched?.approver_role || "CFO";

  // Reset approval workflow for this payment cycle
  await pool.query(
    `INSERT INTO invoice_approval_workflow
       (invoice_id, organization_id, approval_level,
        required_approval_level, approval_status, created_at)
     VALUES ($1, $2, $3, $4, 'PENDING', NOW())
     ON CONFLICT (invoice_id, organization_id)
     DO UPDATE SET
       approval_level          = EXCLUDED.approval_level,
       required_approval_level = EXCLUDED.required_approval_level,
       approval_status         = 'PENDING',
       decision_at             = NULL`,
    [invoice_id, organization_id, required_level, required_level]
  );

  await markDone(invoice_id, organization_id, "PAYMENT_READY");

  return { success: true, nextState: "PENDING_APPROVAL" };
}