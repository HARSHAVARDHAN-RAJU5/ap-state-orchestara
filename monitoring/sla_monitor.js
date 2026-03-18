import pool from "../db.js";
import redis from "../redisClient.js";

console.log("Unified SLA Governance Monitor started...");

setInterval(async () => {

  try {

    const slaRules = await pool.query(
      `SELECT organization_id, state_name, sla_days, escalation_level
       FROM sla_config
       WHERE is_active = TRUE`
    );

    if (!slaRules.rows.length) return;

    for (const rule of slaRules.rows) {

      const { organization_id, state_name, sla_days, escalation_level } = rule;

      // ─── PAYMENT EXECUTION TRIGGER ───────────────────────────
      if (state_name === "ACCOUNTING" && escalation_level === "EXECUTE_PAYMENT") {

        const duePayments = await pool.query(
          `SELECT p.invoice_id
           FROM invoice_payment_schedule p
           JOIN invoice_state_machine s
             ON p.invoice_id = s.invoice_id
            AND p.organization_id = s.organization_id
           WHERE p.organization_id = $1
             AND s.current_state = 'ACCOUNTING'
             AND p.payment_status = 'SCHEDULED'
             AND p.payment_due_date <= CURRENT_DATE`,
          [organization_id]
        );

        for (const payment of duePayments.rows) {
          await redis.xAdd("invoice_events", "*", {
            invoice_id: payment.invoice_id,
            organization_id
          });
          console.log("Payment trigger emitted:", payment.invoice_id);
        }

        continue;
      }

      // ─── GENERIC SLA BREACH — with dedup ─────────────────────
      // Only emit once per sla_days window using last_sla_emitted_at
      const overdue = await pool.query(
        `SELECT invoice_id, organization_id
         FROM invoice_state_machine
         WHERE organization_id = $1
           AND current_state = $2
           AND last_updated < NOW() - ($3 || ' days')::interval
           AND (
             last_sla_emitted_at IS NULL
             OR last_sla_emitted_at < NOW() - INTERVAL '1 hour'
           )`,
        [organization_id, state_name, sla_days]
      );

      if (!overdue.rows.length) continue;

      for (const invoice of overdue.rows) {

        const { invoice_id } = invoice;

        if (escalation_level === "AUTO_BLOCK") {

          await pool.query(
            `UPDATE invoice_state_machine
             SET current_state = 'BLOCKED', last_updated = NOW()
             WHERE invoice_id = $1 AND organization_id = $2`,
            [invoice_id, organization_id]
          );

          await pool.query(
            `INSERT INTO audit_event_log
               (invoice_id, organization_id, old_state, new_state, reason)
             VALUES ($1,$2,$3,$4,$5)`,
            [invoice_id, organization_id, state_name, "BLOCKED", "SLA breached → AUTO_BLOCK"]
          );
        }

        if (escalation_level === "ESCALATE") {

          await pool.query(
            `UPDATE invoice_approval_workflow
             SET escalated = TRUE
             WHERE invoice_id = $1
               AND organization_id = $2
               AND approval_status = 'PENDING'`,
            [invoice_id, organization_id]
          );

          await pool.query(
            `INSERT INTO audit_event_log
               (invoice_id, organization_id, old_state, new_state, reason)
             VALUES ($1,$2,$3,$4,$5)`,
            [invoice_id, organization_id, state_name, state_name, "SLA escalation triggered"]
          );
        }

        // Stamp dedup time BEFORE emitting
        await pool.query(
          `UPDATE invoice_state_machine
           SET last_sla_emitted_at = NOW()
           WHERE invoice_id = $1 AND organization_id = $2`,
          [invoice_id, organization_id]
        );

        await redis.xAdd("invoice_events", "*", { invoice_id, organization_id });

        console.log("SLA breach handled:", invoice_id, state_name);
      }
    }

  } catch (err) {
    console.error("SLA Monitor Error:", err.message);
  }

}, 60000);