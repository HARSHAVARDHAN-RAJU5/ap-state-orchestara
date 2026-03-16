import express from "express";
import pool from "../db.js";
import redis from "../redisClient.js";

const router = express.Router();

router.post("/:invoice_id/decision", async (req, res) => {

  try {

    const { invoice_id } = req.params;
    const { decision, comment, reviewer_role, reviewer_name } = req.body;

    // validate inputs
    const allowedDecisions = ["APPROVE", "ESCALATE", "BLOCK"];
    if (!allowedDecisions.includes(decision)) {
      return res.status(400).json({ error: "Invalid decision" });
    }

    if (!reviewer_role || !reviewer_name) {
      return res.status(400).json({
        error: "reviewer_role and reviewer_name are required"
      });
    }

    // get invoice state and org
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

    if (current_state !== "EXCEPTION_REVIEW") {
      return res.status(400).json({
        error: "Invoice not in EXCEPTION_REVIEW state"
      });
    }

    // get required approval level for this invoice
    const workflowRes = await pool.query(
      `SELECT required_approval_level
       FROM invoice_approval_workflow
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    if (!workflowRes.rows.length) {
      return res.status(400).json({
        error: "No approval workflow found for this invoice"
      });
    }

    const required_level = workflowRes.rows[0].required_approval_level;

    // enforce level check — reject if wrong role
    if (reviewer_role !== required_level) {
      // log the attempt in audit
      await pool.query(
        `INSERT INTO audit_event_log
         (invoice_id, organization_id, old_state, new_state, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          invoice_id,
          organization_id,
          "EXCEPTION_REVIEW",
          "EXCEPTION_REVIEW",
          `Unauthorized approval attempt by ${reviewer_name} (${reviewer_role}). Required: ${required_level}`
        ]
      );

      return res.status(403).json({
        error: `Insufficient approval authority`,
        required: required_level,
        provided: reviewer_role
      });
    }

    // store decision with reviewer info
    await pool.query(
      `INSERT INTO exception_review_decisions
        (invoice_id, organization_id, decision, reason,
         reviewer_role, reviewer_name, decided_at, processed)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), false)
       ON CONFLICT (invoice_id, organization_id)
       DO UPDATE SET
         decision = EXCLUDED.decision,
         reason = EXCLUDED.reason,
         reviewer_role = EXCLUDED.reviewer_role,
         reviewer_name = EXCLUDED.reviewer_name,
         decided_at = NOW(),
         processed = false`,
      [
        invoice_id,
        organization_id,
        decision,
        comment || null,
        reviewer_role,
        reviewer_name
      ]
    );

    // audit log with full reviewer info
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

    // update workflow table with decision
    await pool.query(
      `UPDATE invoice_approval_workflow
       SET approval_status = $1,
           assigned_to = $2,
           decision_at = NOW()
       WHERE invoice_id = $3
       AND organization_id = $4`,
      [decision, reviewer_name, invoice_id, organization_id]
    );

    // wake orchestrator
    await redis.xAdd("invoice_events", "*", {
      invoice_id,
      organization_id
    });

    return res.json({
      message: `Decision recorded`,
      decision,
      approved_by: reviewer_name,
      role: reviewer_role
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }

});

export default router;