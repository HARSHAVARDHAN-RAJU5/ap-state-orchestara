import pool from "../db.js";
import { evaluateTax } from "../core/taxEngineCompliance.js";

export async function execute(context) {

  const { invoice_id, organization_id, config } = context;

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

  const invoice = invoiceRes.rows[0].data;

  // FIX T1-3: Pass organization_id into evaluateTax so vendor lookup
  // is scoped to this org. Previously no org filter was applied.
  const taxResult = await evaluateTax(invoice, organization_id);

  const total = parseFloat(invoice.total_amount || invoice.total || 0);

  const highValueThreshold =
    config?.approval?.high_value_threshold ?? Infinity;

  const high_value_flag = total > highValueThreshold;

  // FIX T3-6: Write compliance evidence to invoice_compliance_results.
  // This table existed in schema but was never populated, making audits impossible.
  const tax_compliance_status = taxResult.status === "PASS" ? "PASS" : "FAIL";
  const policy_compliance_status = high_value_flag ? "HIGH_VALUE" : "PASS";
  const overall_compliance_status =
    tax_compliance_status === "FAIL" ? "FAIL" :
    high_value_flag ? "REVIEW_REQUIRED" : "PASS";

  await pool.query(
    `INSERT INTO invoice_compliance_results
      (invoice_id, organization_id, tax_compliance_status,
       policy_compliance_status, overall_compliance_status, evaluated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (invoice_id, organization_id)
     DO UPDATE SET
       tax_compliance_status    = EXCLUDED.tax_compliance_status,
       policy_compliance_status = EXCLUDED.policy_compliance_status,
       overall_compliance_status = EXCLUDED.overall_compliance_status,
       evaluated_at = NOW()`,
    [
      invoice_id,
      organization_id,
      tax_compliance_status,
      policy_compliance_status,
      overall_compliance_status
    ]
  );

  return {
    success: true,
    signals: {
      tax_status: taxResult.status,
      high_value_flag
    }
  };
}