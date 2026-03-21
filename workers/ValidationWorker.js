import pool from "../db.js";
import { isAlreadyDone, markDone } from "../core/workerIdempotency.js";

function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

export async function execute(context) {

  const { invoice_id, organization_id, config } = context;

  if (!invoice_id || !organization_id) {
    throw new Error("ValidationWorker requires invoice_id and organization_id");
  }

  if (await isAlreadyDone(invoice_id, organization_id, "VALIDATING")) {
    // Re-read the result that was written last time so the agent can evaluate it
    const cached = await pool.query(
      `SELECT overall_status, bank_status, tax_status
       FROM invoice_validation_results
       WHERE invoice_id = $1 AND organization_id = $2`,
      [invoice_id, organization_id]
    );
    if (cached.rows.length) {
      const { overall_status, bank_status, tax_status } = cached.rows[0];
      return {
        success: true,
        status: overall_status,
        reason: bank_status === "MISMATCH"
          ? "Vendor bank account mismatch detected"
          : tax_status === "UNVERIFIED"
          ? "Tax ID could not be verified"
          : "Vendor validated successfully"
      };
    }
  }

  const stateCheck = await pool.query(
    `SELECT current_state
     FROM invoice_state_machine
     WHERE invoice_id = $1
     AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!stateCheck.rows.length) {
    throw new Error("State record not found");
  }

  if (stateCheck.rows[0].current_state !== "VALIDATING") {
    throw new Error("ValidationWorker executed in wrong state");
  }

  const invoiceRes = await pool.query(
    `SELECT data
     FROM invoice_extracted_data
     WHERE invoice_id = $1
     AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, reason: "Extracted invoice data not found" };
  }

  const invoice = invoiceRes.rows[0].data || {};

  // --- FIELD CHECKS ---
  const missingFields = [];
  if (!invoice.invoice_number) missingFields.push("invoice_number");
  if (!invoice.vendor_name)    missingFields.push("vendor_name");
  if (!invoice.total_amount)   missingFields.push("total_amount");
  if (!invoice.invoice_date)   missingFields.push("invoice_date");

  if (missingFields.length > 0) {
    return {
      success: true,
      status: "MISSING_INFO",
      reason: `Missing required fields: ${missingFields.join(", ")}`
    };
  }

  // --- MATH CHECKS ---
  const subtotal = toNumber(invoice.subtotal);
  const tax      = toNumber(invoice.tax);
  const total    = toNumber(invoice.total_amount);

  if (subtotal && tax && Math.abs(subtotal + tax - total) > 1) {
    return {
      success: true,
      status: "REVIEW_REQUIRED",
      reason: `Total mismatch: ${subtotal} + ${tax} ≠ ${total}`
    };
  }

  // --- VENDOR CHECK ---
  const vendorRes = await pool.query(
    `SELECT vendor_id, bank_account, status, tax_id
     FROM vendor_master
     WHERE organization_id = $1
     AND (legal_name ILIKE $2 OR tax_id = $3)
     LIMIT 1`,
    [organization_id, invoice.vendor_name, invoice.gstin || ""]
  );

  if (!vendorRes.rows.length) {
    return {
      success: true,
      status: "REVIEW_REQUIRED",
      reason: `Vendor not found: ${invoice.vendor_name}`
    };
  }

  const vendor = vendorRes.rows[0];

  const legal_status = vendor.status === "ACTIVE" ? "PASS" : "FAIL";

  // --- BANK CHECK ---
  const invoiceBankAccount = invoice.bank_account || null;
  let bank_status = "PASS";

  if (invoiceBankAccount && invoiceBankAccount !== vendor.bank_account) {
    bank_status = "MISMATCH";
  }

  // --- TAX ID CHECK ---
  const tax_status = invoice.gstin && vendor.tax_id === invoice.gstin
    ? "PASS"
    : "UNVERIFIED";

  // --- overall status ---
  let overall_status = "VALID";

  if (legal_status === "FAIL") {
    overall_status = "BLOCKED";
  } else if (bank_status === "MISMATCH") {
    overall_status = "REVIEW_REQUIRED";
  } else if (tax_status === "UNVERIFIED") {
    overall_status = "REVIEW_REQUIRED";
  }

  await pool.query(
    `INSERT INTO invoice_validation_results
      (invoice_id, organization_id, vendor_id,
       legal_status, tax_status, bank_status,
       overall_status, validated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (invoice_id, organization_id)
     DO UPDATE SET
       vendor_id      = EXCLUDED.vendor_id,
       legal_status   = EXCLUDED.legal_status,
       tax_status     = EXCLUDED.tax_status,
       bank_status    = EXCLUDED.bank_status,
       overall_status = EXCLUDED.overall_status,
       validated_at   = NOW()`,
    [
      invoice_id,
      organization_id,
      vendor.vendor_id,
      legal_status,
      tax_status,
      bank_status,
      overall_status
    ]
  );

  await markDone(invoice_id, organization_id, "VALIDATING");

  if (overall_status === "BLOCKED") {
    return {
      success: true,
      status: "BLOCKED",
      reason: `Vendor is inactive: ${invoice.vendor_name}`
    };
  }

  if (overall_status === "REVIEW_REQUIRED") {
    return {
      success: true,
      status: "REVIEW_REQUIRED",
      reason: bank_status === "MISMATCH"
        ? "Vendor bank account mismatch detected"
        : "Tax ID could not be verified"
    };
  }

  return {
    success: true,
    status: "VALID",
    reason: "Vendor validated successfully"
  };
}
