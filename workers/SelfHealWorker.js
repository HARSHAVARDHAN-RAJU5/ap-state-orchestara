import pool from "../db.js";

/**
 * Attempts to auto-fill missing invoice fields from internal data.
 * Called before NotificationWorker — if healing succeeds, invoice
 * goes back to RECEIVED for a fresh pipeline run instead of waiting for vendor.
 *
 * Returns:
 *   { healed: true,  fields: [...] }  → re-emit invoice, skip vendor email
 *   { healed: false, reason: "..." }  → fall through to NotificationWorker
 */
export async function execute(context) {

  const { invoice_id, organization_id } = context;

  // Load current extracted data
  const invoiceRes = await pool.query(
    `SELECT data FROM invoice_extracted_data
     WHERE invoice_id = $1 AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  // No extracted data at all — can't self-heal, vendor needs to resubmit
  if (!invoiceRes.rows.length) {
    return { healed: false, reason: "No extracted data to heal" };
  }

  const data = { ...invoiceRes.rows[0].data };
  const healedFields = [];

  // ── HEAL 1: Missing po_number ──────────────────────────────────
  // Try to find a matching PO by vendor + amount
  if (!data.po_number && data.vendor_name && data.total_amount) {

    const poRes = await pool.query(
      `SELECT po_number FROM purchase_orders
       WHERE organization_id = $1
         AND vendor_id = (
           SELECT vendor_id FROM vendor_master
           WHERE organization_id = $1
             AND legal_name ILIKE $2
           LIMIT 1
         )
         AND ABS(total_amount - $3) / NULLIF(total_amount, 0) <= 0.05
         AND status IN ('OPEN', 'PARTIAL')
       ORDER BY created_at DESC
       LIMIT 1`,
      [organization_id, data.vendor_name, parseFloat(data.total_amount)]
    );

    if (poRes.rows.length) {
      data.po_number = poRes.rows[0].po_number;
      healedFields.push("po_number");
    }
  }

  // ── HEAL 2: Missing gstin ──────────────────────────────────────
  // Look up from vendor_master by vendor name
  if (!data.gstin && data.vendor_name) {

    const vendorRes = await pool.query(
      `SELECT tax_id FROM vendor_master
       WHERE organization_id = $1
         AND legal_name ILIKE $2
         AND tax_id IS NOT NULL
       LIMIT 1`,
      [organization_id, data.vendor_name]
    );

    if (vendorRes.rows.length) {
      data.gstin = vendorRes.rows[0].tax_id;
      healedFields.push("gstin");
    }
  }

  // ── HEAL 3: Missing vendor_name ────────────────────────────────
  // Look up from vendor_master by gstin/tax_id
  if (!data.vendor_name && data.gstin) {

    const vendorRes = await pool.query(
      `SELECT legal_name FROM vendor_master
       WHERE organization_id = $1
         AND tax_id = $2
       LIMIT 1`,
      [organization_id, data.gstin]
    );

    if (vendorRes.rows.length) {
      data.vendor_name = vendorRes.rows[0].legal_name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, "")
        .replace(/\s+/g, " ");
      healedFields.push("vendor_name");
    }
  }

  // ── HEAL 4: Missing invoice_date ───────────────────────────────
  // Fall back to received_at from invoices table
  if (!data.invoice_date) {

    const receivedRes = await pool.query(
      `SELECT received_at FROM invoices
       WHERE invoice_id = $1 AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    if (receivedRes.rows.length) {
      data.invoice_date = receivedRes.rows[0].received_at
        .toISOString()
        .split("T")[0];
      healedFields.push("invoice_date");
    }
  }

  // Nothing was healed — vendor needs to resubmit
  if (healedFields.length === 0) {
    return { healed: false, reason: "Could not auto-resolve missing fields" };
  }

  // Save healed data back to extracted_data
  await pool.query(
    `UPDATE invoice_extracted_data
     SET data = $1, extraction_status = 'HEALED'
     WHERE invoice_id = $2 AND organization_id = $3`,
    [data, invoice_id, organization_id]
  );

  // Log in audit so dashboard shows what was auto-filled
  await pool.query(
    `INSERT INTO audit_event_log
       (invoice_id, organization_id, old_state, new_state, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      invoice_id,
      organization_id,
      "WAITING_INFO",
      "RECEIVED",
      `Self-healed fields: ${healedFields.join(", ")}`
    ]
  );

  return { healed: true, fields: healedFields };
}