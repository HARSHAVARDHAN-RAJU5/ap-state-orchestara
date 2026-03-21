import express from "express";
import pool from "../db.js";
import redis from "../redisClient.js";

const router = express.Router();

router.post("/:invoice_id/decision", async (req, res) => {
  try {
    const { invoice_id } = req.params;
    const { decision, comment, reviewer_role, reviewer_name } = req.body;

    const allowedDecisions = ["APPROVE", "ESCALATE", "BLOCK"];
    if (!allowedDecisions.includes(decision)) {
      return res.status(400).json({ error: "Invalid decision" });
    }

    if (!reviewer_role || !reviewer_name) {
      return res.status(400).json({
        error: "reviewer_role and reviewer_name are required"
      });
    }

    const stateRes = await pool.query(
      `SELECT current_state, organization_id, review_cycle
       FROM invoice_state_machine
       WHERE invoice_id = $1`,
      [invoice_id]
    );

    if (!stateRes.rows.length) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const { current_state, organization_id, review_cycle } = stateRes.rows[0];

    if (current_state !== "EXCEPTION_REVIEW") {
      return res.status(400).json({
        error: "Invoice not in EXCEPTION_REVIEW state"
      });
    }

    // Block duplicate decisions for this cycle
    const pendingCheck = await pool.query(
      `SELECT id FROM exception_review_decisions
       WHERE invoice_id      = $1
         AND organization_id = $2
         AND review_cycle    = $3
         AND (processed = false OR decided_at > NOW() - INTERVAL '10 seconds')`,
      [invoice_id, organization_id, review_cycle]
    );

    if (pendingCheck.rows.length > 0) {
      return res.status(409).json({
        error: "A decision was already submitted for this review cycle. Wait before submitting another."
      });
    }

    // Get required approval level
    let workflowRes = await pool.query(
      `SELECT required_approval_level
       FROM invoice_approval_workflow
       WHERE invoice_id      = $1
       AND   organization_id = $2`,
      [invoice_id, organization_id]
    );

    if (!workflowRes.rows.length) {

      const invoiceRes = await pool.query(
        `SELECT data FROM invoice_extracted_data
         WHERE invoice_id = $1 AND organization_id = $2`,
        [invoice_id, organization_id]
      );

      const total = parseFloat(invoiceRes.rows[0]?.data?.total_amount || 0);

      const configRes = await pool.query(
        `SELECT approver_role FROM approval_config
         WHERE organization_id = $1
           AND $2 >= min_amount AND $2 < max_amount
         ORDER BY min_amount DESC LIMIT 1`,
        [organization_id, total]
      );

      const level = configRes.rows[0]?.approver_role || "CFO";

      await pool.query(
        `INSERT INTO invoice_approval_workflow
           (invoice_id, organization_id, approval_level,
            required_approval_level, approval_status, created_at)
         VALUES ($1, $2, $3, $4, 'PENDING', NOW())`,
        [invoice_id, organization_id, level, level]
      );

      workflowRes = { rows: [{ required_approval_level: level }] };
    }

    const required_level = workflowRes.rows[0].required_approval_level;

    if (reviewer_role !== required_level) {

      await pool.query(
        `INSERT INTO audit_event_log
         (invoice_id, organization_id, old_state, new_state, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          invoice_id,
          organization_id,
          "EXCEPTION_REVIEW",
          "EXCEPTION_REVIEW",
          `Unauthorized attempt by ${reviewer_name} (${reviewer_role}). Required: ${required_level}`
        ]
      );

      return res.status(403).json({
        error: "Insufficient approval authority",
        required: required_level,
        provided: reviewer_role
      });
    }

    await pool.query(
      `INSERT INTO exception_review_decisions
        (invoice_id, organization_id, decision, reason,
         reviewer_role, reviewer_name, decided_at, processed, review_cycle)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), false, $7)`,
      [
        invoice_id,
        organization_id,
        decision,
        comment || null,
        reviewer_role,
        reviewer_name,
        review_cycle
      ]
    );

    await pool.query(
      `INSERT INTO audit_event_log
       (invoice_id, organization_id, old_state, new_state, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        invoice_id,
        organization_id,
        "EXCEPTION_REVIEW",
        "EXCEPTION_REVIEW",
        `Decision: ${decision} by ${reviewer_name} (${reviewer_role})`
      ]
    );

    await pool.query(
      `UPDATE invoice_approval_workflow
       SET approval_status = $1,
           assigned_to     = $2,
           decision_at     = NOW()
       WHERE invoice_id      = $3
       AND   organization_id = $4`,
      [decision, reviewer_name, invoice_id, organization_id]
    );

    await redis.xAdd("invoice_events", "*", {
      invoice_id,
      organization_id
    });

    return res.json({
      message:     "Decision recorded",
      decision,
      approved_by: reviewer_name,
      role:        reviewer_role,
      review_cycle
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;