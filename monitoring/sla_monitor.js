import pool from "../db.js";
import { createClient } from "redis";

const redis = createClient({
  url: "redis://127.0.0.1:6379"
});

redis.on("error", (err) => {
  console.error("Redis Error:", err);
});

await redis.connect();

console.log("Unified SLA Governance Monitor started...");

setInterval(async () => {

  try {

    const slaRules = await pool.query(`
      SELECT organization_id, state_name, sla_days, escalation_level
      FROM sla_config
      WHERE is_active = TRUE
    `);

    if (!slaRules.rows.length) return;

    for (const rule of slaRules.rows) {

      const { organization_id, state_name, sla_days, escalation_level } = rule;

      if (state_name === "ACCOUNTING" && escalation_level === "EXECUTE_PAYMENT") {

        // FIX T2-1: Only emit payment trigger if we haven't emitted one
        // in the last 10 minutes for this invoice. Previously every 60s
        // cycle emitted a new event unconditionally — 100 invoices = 100
        // events/minute flooding Redis, causing double payment attempts.
        const duePayments = await pool.query(
          `SELECT p.invoice_id
           FROM invoice_payment_schedule p
           JOIN invoice_state_machine s
             ON p.invoice_id = s.invoice_id
            AND p.organization_id = s.organization_id
           WHERE p.organization_id = $1
             AND s.current_state = 'ACCOUNTING'
             AND p.payment_status = 'SCHEDULED'
             AND p.payment_due_date <= CURRENT_DATE
             AND (
               s.last_sla_emitted_at IS NULL
               OR s.last_sla_emitted_at < NOW() - INTERVAL '10 minutes'
             )`,
          [organization_id]
        );

        for (const payment of duePayments.rows) {

          const { invoice_id } = payment;

          await redis.xAdd("invoice_events", "*", {
            invoice_id,
            organization_id
          });

          // Stamp the emit time so we don't re-emit for 10 minutes
          await pool.query(
            `UPDATE invoice_state_machine
             SET last_sla_emitted_at = NOW()
             WHERE invoice_id = $1
             AND organization_id = $2`,
            [invoice_id, organization_id]
          );

          console.log("Payment trigger emitted:", invoice_id);
        }

        continue;
      }

      // FIX T2-1: Same dedup logic for all other SLA states.
      // Only pick up invoices that haven't had an SLA event emitted
      // in the last 10 minutes.
      const overdue = await pool.query(
        `SELECT invoice_id, organization_id
         FROM invoice_state_machine
         WHERE organization_id = $1
           AND current_state = $2
           AND last_updated < NOW() - ($3 || ' days')::interval
           AND (
             last_sla_emitted_at IS NULL
             OR last_sla_emitted_at < NOW() - INTERVAL '10 minutes'
           )`,
        [organization_id, state_name, sla_days]
      );

      if (!overdue.rows.length) continue;

      for (const invoice of overdue.rows) {

        const { invoice_id } = invoice;

        if (escalation_level === "AUTO_BLOCK") {

          await pool.query(
            `UPDATE invoice_state_machine
             SET current_state = 'BLOCKED',
                 last_updated = NOW(),
                 last_sla_emitted_at = NOW()
             WHERE invoice_id = $1
               AND organization_id = $2`,
            [invoice_id, organization_id]
          );

          await pool.query(
            `INSERT INTO audit_event_log
             (invoice_id, organization_id, old_state, new_state, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [invoice_id, organization_id, state_name, "BLOCKED", "SLA breached → AUTO_BLOCK"]
          );
        }

        if (escalation_level === "ESCALATE") {

          // FIX T4-3: The escalation UPDATE was silently doing nothing for
          // invoices that reached EXCEPTION_REVIEW without going through
          // PENDING_APPROVAL (no workflow row exists for them). Now we
          // insert a workflow row if one doesn't exist before updating it.
          await pool.query(
            `INSERT INTO invoice_approval_workflow
               (invoice_id, organization_id, approval_status, created_at)
             VALUES ($1, $2, 'PENDING', NOW())
             ON CONFLICT (invoice_id, organization_id) DO NOTHING`,
            [invoice_id, organization_id]
          );

          await pool.query(
            `UPDATE invoice_approval_workflow
             SET escalated = TRUE
             WHERE invoice_id = $1
               AND organization_id = $2
               AND approval_status = 'PENDING'`,
            [invoice_id, organization_id]
          );

          await pool.query(
            `UPDATE invoice_state_machine
             SET last_sla_emitted_at = NOW()
             WHERE invoice_id = $1
               AND organization_id = $2`,
            [invoice_id, organization_id]
          );

          await pool.query(
            `INSERT INTO audit_event_log
             (invoice_id, organization_id, old_state, new_state, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [invoice_id, organization_id, state_name, state_name, "SLA escalation triggered"]
          );
        }

        await redis.xAdd("invoice_events", "*", {
          invoice_id,
          organization_id
        });

        console.log("SLA breach handled:", invoice_id, state_name);
      }
    }

  } catch (err) {
    console.error("SLA Monitor Error:", err.message);
  }

}, 60000);