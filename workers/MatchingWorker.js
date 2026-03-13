import pool from "../db.js";

function toNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

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

  const invoice = invoiceRes.rows[0].data || {};

  const invoiceTotal = toNumber(invoice.total);
  const poNumber = invoice.po_number || null;

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
    return { success: false, reason: "Vendor validation missing" };
  }

  const { vendor_id, bank_status } = validationRes.rows[0];

  const tolerance =
    config?.matching?.price_variance_percentage ?? 0.02;

  let po = null;
  let missing_po_flag = false;
  let price_variance_flag = false;
  const bank_mismatch_flag = bank_status === "MISMATCH";

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

  if (po) {

    const poAmount = toNumber(po.total_amount);

    const variance =
      Math.abs(invoiceTotal - poAmount) / poAmount;

    if (variance > tolerance) {
      price_variance_flag = true;
    }
  }

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
      bank_mismatch_flag
    }
  };
}