import express from "express";
import pool from "../db.js";
import redis from "../redisClient.js";

const router = express.Router();

/*
POST /api/payment/:invoice_id/pay
*/

router.post("/:invoice_id/pay", async (req, res) => {

  try {

    const { invoice_id } = req.params;

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

    if (current_state !== "PAYMENT_READY") {
      return res.status(400).json({
        error: "Invoice not in PAYMENT_READY state"
      });
    }

    // mark payment paid
    await pool.query(
      `
      UPDATE invoice_payment_schedule
      SET payment_status = 'PAID',
          paid_at = NOW()
      WHERE invoice_id = $1
      AND organization_id = $2
      `,
      [invoice_id, organization_id]
    );

    // move invoice state
    await pool.query(
      `
      UPDATE invoice_state_machine
      SET current_state = 'COMPLETED'
      WHERE invoice_id = $1
      AND organization_id = $2
      `,
      [invoice_id, organization_id]
    );

    // wake orchestrator
    await redis.xAdd("invoice_events", "*", {
      invoice_id,
      organization_id
    });

    return res.json({
      message: "Payment executed successfully"
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: "Internal server error"
    });

  }

});

export default router;