import pool from "../db.js";
import { evaluateTax } from "../core/taxEngineCompliance.js";

export async function execute(context) {

  const { invoice_id, organization_id, config } = context;

  const invoiceRes = await pool.query(
    `SELECT data
     FROM invoice_extracted_data
     WHERE invoice_id = $1 AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, reason: "Invoice data not found" };
  }

  const invoice = invoiceRes.rows[0].data;

  // Pass organization_id — fixes cross-tenant tax leak
  const taxResult = await evaluateTax(invoice, organization_id);

  const total = parseFloat(invoice.total_amount || invoice.total || 0);
  const highValueThreshold = config?.approval?.high_value_threshold ?? Infinity;
  const high_value_flag = total > highValueThreshold;

  // Write compliance results (was missing before)
  await pool.query(
    `INSERT INTO invoice_compliance_results
       (invoice_id, organization_id, tax_status, high_value_flag, evaluated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (invoice_id, organization_id)
     DO UPDATE SET
       tax_status = EXCLUDED.tax_status,
       high_value_flag = EXCLUDED.high_value_flag,
       evaluated_at = NOW()`,
    [invoice_id, organization_id, taxResult.status, high_value_flag]
  );

  return {
    success: true,
    signals: {
      tax_status: taxResult.status,
      high_value_flag
    }
  };
}