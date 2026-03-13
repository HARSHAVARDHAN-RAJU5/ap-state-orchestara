import pool from "../db.js";

function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

export async function execute(context) {

  const { invoice_id, organization_id, config } = context;

  if (!invoice_id || !organization_id) {
    throw new Error("MatchingWorker requires invoice_id and organization_id");
  }

  // Ensure correct state
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
    throw new Error("State record not found");
  }

  if (stateCheck.rows[0].current_state !== "MATCHING") {
    throw new Error("MatchingWorker executed in wrong state");
  }

  // Load invoice
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
    return {
      success: false,
      reason: "Extracted invoice data not found"
    };
  }

  const invoice = invoiceRes.rows[0].data || {};

  const invoiceTotal = toNumber(invoice.total);
  const poNumber = invoice.po_number || null;

  // Load validation result
  const validationRes = await pool.query(
    `
    SELECT vendor_id, bank_status
    FROM invoice_validation_results
    WHERE invoice_id = $1
    AND organization_id = $2
    `,
    [invoice_id, organization_id]
  );

  if (!validationRes.rows.length) {
    return {
      success: false,
      reason: "Vendor validation result not found"
    };
  }

  const { vendor_id, bank_status } = validationRes.rows[0];

  const tolerance =
    config?.matching?.price_variance_percentage ?? 0.02;

  let po = null;
  let missing_po_flag = false;
  let price_variance_flag = false;
  const bank_mismatch_flag = bank_status === "MISMATCH";

  // Direct PO match
  if (poNumber) {

    const poRes = await pool.query(
      `
      SELECT *
      FROM purchase_orders
      WHERE po_number = $1
      AND organization_id = $2
      `,
      [poNumber, organization_id]
    );

    if (poRes.rows.length) {
      po = poRes.rows[0];
    }
  }

  // Fallback vendor match
  if (!po) {

    const poRes = await pool.query(
      `
      SELECT *
      FROM purchase_orders
      WHERE vendor_id = $1
      AND organization_id = $2
      `,
      [vendor_id, organization_id]
    );

    const matches = poRes.rows.filter(p => {

      const poAmount = toNumber(p.total_amount);

      if (!poAmount) return false;

      const variance =
        Math.abs(invoiceTotal - poAmount) / poAmount;

      return variance <= tolerance;

    });

    if (matches.length === 1) {
      po = matches[0];
    } else {
      missing_po_flag = true;
    }
  }

  // Variance check
  if (po) {

    const poAmount = toNumber(po.total_amount);

    if (poAmount) {

      const variance =
        Math.abs(invoiceTotal - poAmount) / poAmount;

      if (variance > tolerance) {
        price_variance_flag = true;
      }

    } else {
      price_variance_flag = true;
    }
  }

  // Compliance checks
  const subtotal = toNumber(invoice.subtotal);
  const tax = toNumber(invoice.tax);
  const total = toNumber(invoice.total);

  let tax_status = "PASS";

  if (Math.abs(subtotal + tax - total) > 1) {
    tax_status = "FAIL";
  }

  const highValueThreshold =
    config?.approval?.high_value_threshold ?? Infinity;

  const high_value_flag = total > highValueThreshold;

  // Persist results
  await pool.query(
    `
    INSERT INTO invoice_po_matching_results
    (invoice_id, organization_id, po_number,
     matching_status, missing_po_flag,
     price_variance_flag, bank_mismatch_flag,
     matched_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (invoice_id, organization_id)
    DO UPDATE SET
      po_number = EXCLUDED.po_number,
      matching_status = EXCLUDED.matching_status,
      missing_po_flag = EXCLUDED.missing_po_flag,
      price_variance_flag = EXCLUDED.price_variance_flag,
      bank_mismatch_flag = EXCLUDED.bank_mismatch_flag,
      matched_at = NOW()
    `,
    [
      invoice_id,
      organization_id,
      po ? po.po_number : null,
      po ? "MATCHED" : "MISMATCH",
      missing_po_flag,
      price_variance_flag,
      bank_mismatch_flag
    ]
  );

  return {
    success: true,
    signals: {
      missing_po_flag,
      price_variance_flag,
      bank_mismatch_flag,
      tax_status,
      high_value_flag
    }
  };
}