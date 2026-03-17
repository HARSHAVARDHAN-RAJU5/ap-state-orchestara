import express from "express";
import pool from "../db.js";

const router = express.Router();

// ── 1. Overview stats ─────────────────────────────────────────────
router.get("/stats/:org_id", async (req, res) => {
  try {
    const { org_id } = req.params;

    const states = await pool.query(
      `SELECT current_state, COUNT(*) as count
       FROM invoice_state_machine
       WHERE organization_id = $1
       GROUP BY current_state`,
      [org_id]
    );

    const today = await pool.query(
      `SELECT COUNT(*) as count
       FROM invoice_state_machine
       WHERE organization_id = $1
       AND current_state = 'COMPLETED'
       AND last_updated >= CURRENT_DATE`,
      [org_id]
    );

    const blocked = await pool.query(
      `SELECT COUNT(*) as count
       FROM invoice_state_machine
       WHERE organization_id = $1
       AND current_state = 'BLOCKED'`,
      [org_id]
    );

    const pending_approval = await pool.query(
      `SELECT COUNT(*) as count
       FROM invoice_state_machine
       WHERE organization_id = $1
       AND current_state = 'EXCEPTION_REVIEW'`,
      [org_id]
    );

    res.json({
      by_state: states.rows,
      completed_today: parseInt(today.rows[0].count),
      blocked: parseInt(blocked.rows[0].count),
      pending_approval: parseInt(pending_approval.rows[0].count)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ── 2. Invoice list ───────────────────────────────────────────────
router.get("/invoices/:org_id", async (req, res) => {
  try {
    const { org_id } = req.params;

    const result = await pool.query(
      `SELECT
         i.invoice_id,
         i.original_filename,
         i.received_at,
         s.current_state,
         s.last_updated,
         s.retry_count,
         e.data->>'vendor_name'   as vendor_name,
         e.data->>'invoice_number' as invoice_number,
         e.data->>'total_amount'  as total_amount,
         e.data->>'invoice_date'  as invoice_date,
         NOW() - s.last_updated   as time_in_state
       FROM invoices i
       JOIN invoice_state_machine s
         ON i.invoice_id = s.invoice_id
        AND i.organization_id = s.organization_id
       LEFT JOIN invoice_extracted_data e
         ON i.invoice_id = e.invoice_id
        AND i.organization_id = e.organization_id
       WHERE i.organization_id = $1
       ORDER BY i.received_at DESC`,
      [org_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
});

// ── 3. Single invoice detail ──────────────────────────────────────
router.get("/invoice/:org_id/:invoice_id", async (req, res) => {
  try {
    const { org_id, invoice_id } = req.params;

    // Audit trail
    const audit = await pool.query(
      `SELECT old_state, new_state, reason, created_at
       FROM audit_event_log
       WHERE invoice_id = $1
       AND organization_id = $2
       ORDER BY created_at ASC`,
      [invoice_id, org_id]
    );

    // Extracted data
    const extracted = await pool.query(
      `SELECT data, extraction_status, extracted_at
       FROM invoice_extracted_data
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, org_id]
    );

    // Validation result
    const validation = await pool.query(
      `SELECT vendor_id, legal_status, tax_status, bank_status, overall_status, validated_at
       FROM invoice_validation_results
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, org_id]
    );

    // Matching result
    const matching = await pool.query(
      `SELECT po_number, matching_status, missing_po_flag, price_variance_flag, bank_mismatch_flag, matched_at
       FROM invoice_po_matching_results
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, org_id]
    );

    // Payment schedule
    const payment = await pool.query(
      `SELECT payment_status, payment_due_date, payment_method, scheduled_at, paid_at
       FROM invoice_payment_schedule
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, org_id]
    );

    // Approval workflow
    const approval = await pool.query(
      `SELECT approval_level, required_approval_level, approval_status, escalated, decision_at
       FROM invoice_approval_workflow
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, org_id]
    );

    // Compliance result
    const compliance = await pool.query(
      `SELECT tax_compliance_status, policy_compliance_status, overall_compliance_status, evaluated_at
       FROM invoice_compliance_results
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, org_id]
    );

    res.json({
      audit_trail: audit.rows,
      extracted: extracted.rows[0] || null,
      validation: validation.rows[0] || null,
      matching: matching.rows[0] || null,
      payment: payment.rows[0] || null,
      approval: approval.rows[0] || null,
      compliance: compliance.rows[0] || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch invoice detail" });
  }
});

// ── 4. SLA breaches ───────────────────────────────────────────────
router.get("/sla/:org_id", async (req, res) => {
  try {
    const { org_id } = req.params;

    const result = await pool.query(
      `SELECT
         s.invoice_id,
         s.current_state,
         s.last_updated,
         sc.sla_days,
         sc.escalation_level,
         e.data->>'vendor_name'  as vendor_name,
         e.data->>'total_amount' as total_amount,
         EXTRACT(EPOCH FROM (NOW() - s.last_updated))/3600 as hours_in_state
       FROM invoice_state_machine s
       JOIN sla_config sc
         ON sc.state_name = s.current_state
        AND sc.organization_id = s.organization_id
       LEFT JOIN invoice_extracted_data e
         ON s.invoice_id = e.invoice_id
        AND s.organization_id = e.organization_id
       WHERE s.organization_id = $1
         AND sc.is_active = true
         AND s.last_updated < NOW() - (sc.sla_days || ' days')::interval
         AND s.current_state NOT IN ('COMPLETED', 'BLOCKED')
       ORDER BY hours_in_state DESC`,
      [org_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch SLA breaches" });
  }
});

// ── 5. Pending approvals ──────────────────────────────────────────
router.get("/approvals/:org_id", async (req, res) => {
  try {
    const { org_id } = req.params;

    const result = await pool.query(
      `SELECT
         s.invoice_id,
         s.last_updated,
         e.data->>'vendor_name'    as vendor_name,
         e.data->>'invoice_number' as invoice_number,
         e.data->>'total_amount'   as total_amount,
         w.required_approval_level,
         w.escalated,
         w.created_at as sent_for_approval_at
       FROM invoice_state_machine s
       JOIN invoice_approval_workflow w
         ON s.invoice_id = w.invoice_id
        AND s.organization_id = w.organization_id
       LEFT JOIN invoice_extracted_data e
         ON s.invoice_id = e.invoice_id
        AND s.organization_id = e.organization_id
       WHERE s.organization_id = $1
         AND s.current_state = 'EXCEPTION_REVIEW'
         AND w.approval_status = 'PENDING'
       ORDER BY w.created_at ASC`,
      [org_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch pending approvals" });
  }
});

export default router;