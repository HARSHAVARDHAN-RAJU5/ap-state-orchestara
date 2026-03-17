import db from "../db.js";

// FIX T1-3: Added organization_id parameter to all vendor queries.
// Previously the vendor lookup had no org_id filter — a GSTIN used by
// a vendor in ORG-2 could match and return the wrong country_code for ORG-1,
// causing the wrong tax rate to be applied. This is both a correctness bug
// and a cross-tenant data leak.

export const evaluateTax = async (invoice, organization_id) => {

  if (!invoice) {
    return { status: "FAIL", reason: "Invoice data missing" };
  }

  if (!organization_id) {
    return { status: "FAIL", reason: "organization_id is required for tax evaluation" };
  }

  // Extract GST / Tax ID from invoice
  const gst = invoice.gstin || invoice.tax_id || invoice.supplier_gst || null;

  if (!gst) {
    return { status: "FAIL", reason: "GST not provided" };
  }

  // Fetch vendor country — scoped to this org
  const vendorRes = await db.query(
    `SELECT country_code
     FROM vendor_master
     WHERE tax_id = $1
     AND organization_id = $2`,
    [gst, organization_id]
  );

  if (!vendorRes.rows.length) {
    return { status: "FAIL", reason: "Vendor not found for GST in this organization" };
  }

  const countryCode = vendorRes.rows[0].country_code;

  // Fetch latest applicable tax rule
  const ruleRes = await db.query(
    `SELECT expected_rate
     FROM tax_rules_master
     WHERE country_code = $1
       AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [countryCode]
  );

  if (!ruleRes.rows.length) {
    return { status: "FAIL", reason: "No tax rule found" };
  }

  const expectedRate = parseFloat(ruleRes.rows[0].expected_rate);

  // Extract financial values
  const subtotal = parseFloat(invoice.subtotal ?? 0);
  const taxAmount = parseFloat(invoice.tax ?? 0);

  if (!subtotal || !taxAmount || !expectedRate) {
    return { status: "FAIL", reason: "Missing financial values" };
  }

  // Calculate expected tax
  const expectedTax = subtotal * expectedRate;

  // Allow ₹1 rounding tolerance
  const difference = Math.abs(expectedTax - taxAmount);

  if (difference < 1) {
    return {
      status: "PASS",
      expected_tax: expectedTax,
      actual_tax: taxAmount
    };
  }

  return {
    status: "FAIL",
    expected_tax: expectedTax,
    actual_tax: taxAmount
  };
};