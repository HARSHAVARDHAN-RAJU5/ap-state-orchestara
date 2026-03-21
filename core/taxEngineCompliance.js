import db from "../db.js";

export const evaluateTax = async (invoice, organization_id) => {

  if (!invoice) {
    return { status: "FAIL", reason: "Invoice data missing" };
  }

  if (!organization_id) {
    return { status: "FAIL", reason: "organization_id required for tax evaluation" };
  }

  const gst = invoice.gstin || invoice.tax_id || invoice.supplier_gst || null;

  if (!gst) {
    return { status: "FAIL", reason: "GST not provided" };
  }

  // Scoped to organization — prevents cross-tenant vendor match
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

  const subtotal = parseFloat(invoice.subtotal ?? 0);
  const taxAmount = parseFloat(invoice.tax ?? 0);

  if (!subtotal || !taxAmount || !expectedRate) {
    return { status: "FAIL", reason: "Missing financial values for tax calculation" };
  }

  const expectedTax = subtotal * expectedRate;
  const difference = Math.abs(expectedTax - taxAmount);

  if (difference < 1) {
    return { status: "PASS", expected_tax: expectedTax, actual_tax: taxAmount };
  }

  return { status: "FAIL", expected_tax: expectedTax, actual_tax: taxAmount };
};