import db from "../../../db.js";

export const runMatching = async (context) => {

  const { invoice_id, organization_id, config } = context;

  if (!invoice_id || !organization_id) {
    throw new Error("runMatching requires invoice_id and organization_id");
  }

  // -----------------------------
  // 1️⃣ Vendor validation check
  // -----------------------------
  const validationRes = await db.query(
    `
    SELECT overall_status, vendor_id, bank_status
    FROM invoice_validation_results
    WHERE invoice_id = $1
      AND organization_id = $2
    `,
    [invoice_id, organization_id]
  );

  if (
    !validationRes.rows.length ||
    validationRes.rows[0].overall_status !== "VALID"
  ) {
    return { success: false, reason: "Vendor not valid" };
  }

  const { vendor_id, bank_status } = validationRes.rows[0];

  // Bank mismatch signal
  const bank_mismatch_flag = bank_status === "MISMATCH";

  // -----------------------------
  // 2️⃣ Extract invoice data
  // -----------------------------
  const invoiceRes = await db.query(
    `
    SELECT data
    FROM invoice_extracted_data
    WHERE invoice_id = $1
      AND organization_id = $2
    `,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, reason: "Extracted data not found" };
  }

  const invoice = invoiceRes.rows[0].data || {};

  const invoiceTotal = parseFloat(invoice.total_amount || 0);
  const poNumber = invoice.po_number || null;

  if (!invoiceTotal) {
    return { success: false, reason: "Invoice total missing" };
  }

  const tolerance =
    config?.matching?.price_variance_percentage ?? 0.02;

  let po = null;
  let missing_po_flag = false;
  let price_variance_flag = false;

  // -----------------------------
  // 3️⃣ Direct PO number match
  // -----------------------------
  if (poNumber) {

    const poRes = await db.query(
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

  // -----------------------------
  // 4️⃣ Vendor fallback matching
  // -----------------------------
  if (!po) {

    const vendorPOs = await db.query(
      `
      SELECT *
      FROM purchase_orders
      WHERE vendor_id = $1
        AND organization_id = $2
      `,
      [vendor_id, organization_id]
    );

    const matches = vendorPOs.rows.filter(p => {

      const poAmount = parseFloat(p.total_amount || 0);
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

  // -----------------------------
  // 5️⃣ Strict variance check
  // -----------------------------
  if (po) {

    const poAmount = parseFloat(po.total_amount || 0);

    if (!poAmount) {

      price_variance_flag = true;

    } else {

      const variance =
        Math.abs(invoiceTotal - poAmount) / poAmount;

      if (variance > tolerance) {
        price_variance_flag = true;
      }
    }
  }

  // -----------------------------
  // 6️⃣ Persist matching results
  // -----------------------------
  await db.query(
    `
    INSERT INTO invoice_po_matching_results
    (
      invoice_id,
      organization_id,
      po_number,
      matching_status,
      missing_po_flag,
      price_variance_flag,
      missing_receipt_flag,
      matched_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (invoice_id, organization_id)
    DO UPDATE SET
      po_number = EXCLUDED.po_number,
      matching_status = EXCLUDED.matching_status,
      missing_po_flag = EXCLUDED.missing_po_flag,
      price_variance_flag = EXCLUDED.price_variance_flag,
      missing_receipt_flag = EXCLUDED.missing_receipt_flag,
      matched_at = NOW()
    `,
    [
      invoice_id,
      organization_id,
      po ? po.po_number : null,
      po ? "MATCHED" : "MISMATCH",
      missing_po_flag,
      price_variance_flag,
      false
    ]
  );

  // -----------------------------
  // 7️⃣ Return signals for LLM
  // -----------------------------
  return {
    success: true,
    signals: {
      missing_po_flag,
      price_variance_flag,
      bank_mismatch_flag
    }
  };
};