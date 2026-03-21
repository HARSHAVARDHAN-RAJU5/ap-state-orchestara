import express from "express";
import pool from "../db.js";
import redis from "../redisClient.js";

const router = express.Router();

router.post("/:invoice_id/decision", async (req, res) => {
  try {
    const { invoice_id } = req.params;
    const { decision, comment, reviewer_role, reviewer_name } = req.body;

    const allowedDecisions = ["APPROVE", "REJECT"];
    if (!allowedDecisions.includes(decision)) {
      return res.status(400).json({ error: "Invalid decision. Use APPROVE or REJECT." });
    }

    if (!reviewer_role || !reviewer_name) {
      return res.status(400).json({
        error: "reviewer_role and reviewer_name are required"
      });
    }

    // Get invoice state and org
    const stateRes = await pool.query(
      `SELECT current_state, organization_id
       FROM invoice_state_machine
       WHERE invoice_id = $1`,
      [invoice_id]
    );

    if (!stateRes.rows.length) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const { current_state, organization_id } = stateRes.rows[0];

    if (current_state !== "PENDING_APPROVAL") {
      return res.status(400).json({
        error: `Invoice not in PENDING_APPROVAL state. Current state: ${current_state}`
      });
    }

    // Get required approval level from workflow
    const workflowRes = await pool.query(
      `SELECT required_approval_level
       FROM invoice_approval_workflow
       WHERE invoice_id      = $1
       AND   organization_id = $2`,
      [invoice_id, organization_id]
    );

    if (!workflowRes.rows.length) {
      return res.status(400).json({
        error: "No approval workflow found for this invoice"
      });
    }

    const required_level = workflowRes.rows[0].required_approval_level;

    // Enforce approval level
    if (reviewer_role !== required_level) {

      await pool.query(
        `INSERT INTO audit_event_log
         (invoice_id, organization_id, old_state, new_state, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          invoice_id,
          organization_id,
          "PENDING_APPROVAL",
          "PENDING_APPROVAL",
          `Unauthorized approval attempt by ${reviewer_name} (${reviewer_role}). Required: ${required_level}`
        ]
      );

      return res.status(403).json({
        error: "Insufficient approval authority",
        required: required_level,
        provided: reviewer_role
      });
    }

    // Block if a decision is already pending
    const pendingCheck = await pool.query(
      `SELECT id FROM invoice_payment_approvals
       WHERE invoice_id      = $1
         AND organization_id = $2
         AND (processed = false OR decided_at > NOW() - INTERVAL '10 seconds')`,
      [invoice_id, organization_id]
    );

    if (pendingCheck.rows.length > 0) {
      return res.status(409).json({
        error: "A decision was already submitted. Wait before submitting another."
      });
    }

    // Insert payment approval decision
    await pool.query(
      `INSERT INTO invoice_payment_approvals
        (invoice_id, organization_id, decision, reason,
         reviewer_role, reviewer_name, decided_at, processed)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), false)`,
      [
        invoice_id,
        organization_id,
        decision,
        comment || null,
        reviewer_role,
        reviewer_name
      ]
    );

    // Update workflow table
    await pool.query(
      `UPDATE invoice_approval_workflow
       SET approval_status = $1,
           assigned_to     = $2,
           decision_at     = NOW()
       WHERE invoice_id      = $3
       AND   organization_id = $4`,
      [decision, reviewer_name, invoice_id, organization_id]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_event_log
       (invoice_id, organization_id, old_state, new_state, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        invoice_id,
        organization_id,
        "PENDING_APPROVAL",
        "PENDING_APPROVAL",
        `Payment decision: ${decision} by ${reviewer_name} (${reviewer_role})`
      ]
    );

    // Wake orchestrator
    await redis.xAdd("invoice_events", "*", {
      invoice_id,
      organization_id
    });

    return res.json({
      message:     "Payment approval decision recorded",
      decision,
      approved_by: reviewer_name,
      role:        reviewer_role
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;