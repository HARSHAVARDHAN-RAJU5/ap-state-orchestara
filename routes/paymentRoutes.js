import express from "express";
import pool from "../db.js";
import redis from "../redisClient.js";

const router = express.Router();

router.post("/:invoice_id/pay", async (req, res) => {

  try {

    const { invoice_id } = req.params;

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

    if (current_state !== "PAYMENT_READY") {
      return res.status(400).json({ error: "Invoice not in PAYMENT_READY state" });
    }

    // Log the manual trigger in audit
    await pool.query(
      `INSERT INTO audit_event_log
       (invoice_id, organization_id, old_state, new_state, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [invoice_id, organization_id, "PAYMENT_READY", "PAYMENT_READY", "Manual payment trigger via API"]
    );

    // Wake orchestrator — let it handle the state transition properly
    await redis.xAdd("invoice_events", "*", {
      invoice_id,
      organization_id
    });

    return res.json({ message: "Payment trigger sent to orchestrator" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }

});

export default router;