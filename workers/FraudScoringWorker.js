import pool from "../db.js";
import { isAlreadyDone, markDone } from "../core/workerIdempotency.js";

const SCORE_AUTO_PASS = 30;
const SCORE_REVIEW    = 60;

export async function execute(context) {

  const { invoice_id, organization_id } = context;

  if (await isAlreadyDone(invoice_id, organization_id, "FRAUD_SCREENING")) {
    const cached = await pool.query(
      `SELECT risk_score, signals
       FROM invoice_fraud_scores
       WHERE invoice_id = $1 AND organization_id = $2`,
      [invoice_id, organization_id]
    );
    if (cached.rows.length) {
      const { risk_score, signals } = cached.rows[0];
      const score = parseInt(risk_score, 10);
      return {
        success: true,
        risk_score: score,
        signals: signals,
        outcome: score < SCORE_AUTO_PASS ? "PASS" : score < SCORE_REVIEW ? "REVIEW" : "BLOCK"
      };
    }
  }

  const invoiceRes = await pool.query(
    `SELECT data FROM invoice_extracted_data
     WHERE invoice_id = $1 AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, reason: "Invoice data not found" };
  }

  const invoice = invoiceRes.rows[0].data;
  const total   = parseFloat(invoice.total_amount || 0);
  const vendor  = invoice.vendor_name || null;

  const signals = [];
  let score = 0;

  // SIGNAL 1: Round number amount
  if (total > 0 && total % 1000 === 0) {
    score += 15;
    signals.push({ signal: "ROUND_AMOUNT", score: 15, value: total });
  }

  // SIGNAL 2: First ever invoice from this vendor
  const vendorHistoryRes = await pool.query(
    `SELECT COUNT(*) as count
     FROM invoice_extracted_data
     WHERE organization_id = $1
       AND data->>'vendor_name' = $2
       AND invoice_id <> $3`,
    [organization_id, vendor, invoice_id]
  );

  const vendorInvoiceCount = parseInt(vendorHistoryRes.rows[0].count, 10);
  if (vendorInvoiceCount === 0) {
    score += 20;
    signals.push({ signal: "FIRST_TIME_VENDOR", score: 20, value: vendor });
  }

  // SIGNAL 3: Same vendor multiple invoices in last 24 hours
  const rapidSubmissionRes = await pool.query(
    `SELECT COUNT(*) as count
     FROM invoices i
     JOIN invoice_extracted_data e
       ON i.invoice_id = e.invoice_id
      AND i.organization_id = e.organization_id
     WHERE i.organization_id = $1
       AND e.data->>'vendor_name' = $2
       AND i.received_at > NOW() - INTERVAL '24 hours'
       AND i.invoice_id <> $3`,
    [organization_id, vendor, invoice_id]
  );

  const rapidCount = parseInt(rapidSubmissionRes.rows[0].count, 10);
  if (rapidCount >= 2) {
    score += 25;
    signals.push({ signal: "RAPID_RESUBMISSION", score: 25, value: rapidCount });
  }

  // SIGNAL 4: Invoice date backdated more than 30 days
  if (invoice.invoice_date) {
    const invoiceDate = new Date(invoice.invoice_date);
    const today       = new Date();
    const diffDays    = (today - invoiceDate) / (1000 * 60 * 60 * 24);

    if (diffDays > 30) {
      score += 20;
      signals.push({ signal: "BACKDATED_INVOICE", score: 20, value: Math.round(diffDays) });
    }
  }

  // SIGNAL 5: Amount significantly above vendor historical avg
  if (vendorInvoiceCount > 0) {
    const avgRes = await pool.query(
      `SELECT AVG((data->>'total_amount')::numeric) as avg_amount
       FROM invoice_extracted_data
       WHERE organization_id = $1
         AND data->>'vendor_name' = $2
         AND invoice_id <> $3`,
      [organization_id, vendor, invoice_id]
    );

    const avgAmount = parseFloat(avgRes.rows[0].avg_amount || 0);
    if (avgAmount > 0 && total > avgAmount * 2.5) {
      score += 25;
      signals.push({ signal: "AMOUNT_SPIKE", score: 25, value: { total, avg: Math.round(avgAmount) } });
    }
  }

  // SIGNAL 6: PO number reused across multiple invoices
  if (invoice.po_number) {
    const poReuseRes = await pool.query(
      `SELECT COUNT(*) as count
       FROM invoice_extracted_data
       WHERE organization_id = $1
         AND data->>'po_number' = $2
         AND invoice_id <> $3`,
      [organization_id, invoice.po_number, invoice_id]
    );

    const poReuseCount = parseInt(poReuseRes.rows[0].count, 10);
    if (poReuseCount >= 1) {
      score += 30;
      signals.push({ signal: "PO_REUSE", score: 30, value: invoice.po_number });
    }
  }

  await pool.query(
    `INSERT INTO invoice_fraud_scores
       (invoice_id, organization_id, risk_score, signals, evaluated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (invoice_id, organization_id)
     DO UPDATE SET
       risk_score   = EXCLUDED.risk_score,
       signals      = EXCLUDED.signals,
       evaluated_at = NOW()`,
    [invoice_id, organization_id, score, JSON.stringify(signals)]
  );

  await markDone(invoice_id, organization_id, "FRAUD_SCREENING");

  let outcome;
  if (score < SCORE_AUTO_PASS)  outcome = "PASS";
  else if (score < SCORE_REVIEW) outcome = "REVIEW";
  else                           outcome = "BLOCK";

  return {
    success: true,
    risk_score: score,
    signals,
    outcome
  };
}
