import express from "express";
import pool from "../db.js";
import redis from "../redisClient.js";

const router = express.Router();

/*
POST /api/review/:invoice_id/decision

Body:
{
  "decision": "APPROVE",
  "comment": "Looks correct"
}
*/

router.post("/:invoice_id/decision", async (req, res) => {

  try {

    const { invoice_id } = req.params;
    const { decision, comment } = req.body;

    const allowed = ["APPROVE", "ESCALATE", "BLOCK"];

    if (!allowed.includes(decision)) {
      return res.status(400).json({
        error: "Invalid decision"
      });
    }

    const stateRes = await pool.query(
      `
      SELECT current_state, organization_id
      FROM invoice_state_machine
      WHERE invoice_id = $1
      `,
      [invoice_id]
    );

    if (!stateRes.rows.length) {
      return res.status(404).json({
        error: "Invoice not found"
      });
    }

    const { current_state, organization_id } = stateRes.rows[0];

    if (current_state !== "EXCEPTION_REVIEW") {
      return res.status(400).json({
        error: "Invoice not awaiting review"
      });
    }

    // store reviewer decision
    await pool.query(
      `
      INSERT INTO exception_review_decisions
      (invoice_id, organization_id, decision, reason, decided_at, processed)
      VALUES ($1,$2,$3,$4,NOW(),false)
      ON CONFLICT (invoice_id, organization_id)
      DO UPDATE SET
        decision = EXCLUDED.decision,
        reason = EXCLUDED.reason,
        decided_at = NOW(),
        processed = false
      `,
      [
        invoice_id,
        organization_id,
        decision,
        comment || null
      ]
    );

    // audit trail
    await pool.query(
      `
      INSERT INTO audit_event_log
      (invoice_id, old_state, new_state, reason, organization_id, created_at)
      VALUES ($1,'EXCEPTION_REVIEW','EXCEPTION_REVIEW',$2,$3,NOW())
      `,
      [
        invoice_id,
        `Review decision recorded: ${decision}`,
        organization_id
      ]
    );

    // wake orchestrator
    await redis.xAdd("invoice_events", "*", {
      invoice_id,
      organization_id
    });

    return res.json({
      message: "Review decision recorded successfully"
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Internal server error"
    });

  }

});

export default router;