import pool from "../db.js";
import { evaluateTax } from "../core/taxEngineCompliance.js";

export async function execute(context) {

  const { invoice_id, organization_id, config } = context;

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

  const invoice = invoiceRes.rows[0].data;

  const taxResult = await evaluateTax(invoice);

  const total = parseFloat(invoice.total || 0);

  const highValueThreshold =
    config?.approval?.high_value_threshold ?? Infinity;

  const high_value_flag = total > highValueThreshold;

  return {
    success: true,
    signals: {
      tax_status: taxResult.status,
      high_value_flag
    }
  };
}