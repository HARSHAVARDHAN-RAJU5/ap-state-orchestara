import redis from "./redisClient.js";
import pool from "./db.js";
import dotenv from "dotenv";
dotenv.config();

import SupervisorAgent from "./agent/SupervisorAgent.js";
import * as NotificationWorker from "./workers/NotificationWorker.js";
import PolicyEngine from "./core/PolicyEngine.js";
import reflectionService from "./core/ReflectionService.js";

const STATE_TRANSITIONS = {

  RECEIVED: ["STRUCTURED", "WAITING_INFO"],

  STRUCTURED: ["DUPLICATE_CHECK", "BLOCKED"],

  DUPLICATE_CHECK: ["VALIDATING", "BLOCKED", "EXCEPTION_REVIEW", "WAITING_INFO"],

  VALIDATING: ["MATCHING", "WAITING_INFO", "BLOCKED", "EXCEPTION_REVIEW"],

  MATCHING: ["FRAUD_SCREENING", "WAITING_INFO", "EXCEPTION_REVIEW", "BLOCKED"],

  FRAUD_SCREENING: ["COMPLIANCE", "EXCEPTION_REVIEW", "BLOCKED"],

  COMPLIANCE: ["PAYMENT_READY", "EXCEPTION_REVIEW", "BLOCKED"],

  // PAYMENT_READY can go to EXCEPTION_REVIEW if something goes wrong
  // e.g. payment scheduling fails, bank mismatch, etc.
  PAYMENT_READY: ["PENDING_APPROVAL", "EXCEPTION_REVIEW", "BLOCKED"],

  // PENDING_APPROVAL is a real human wait state.
  // Human approves via /api/approvals/:invoice_id/decision
  // APPROVE → APPROVED
  // REJECT  → EXCEPTION_REVIEW (escalate to superior)
  PENDING_APPROVAL: ["APPROVED", "EXCEPTION_REVIEW", "BLOCKED"],

  WAITING_INFO: ["RECEIVED"],

  // EXCEPTION_REVIEW handles escalations only.
  // APPROVE here means the exception is resolved — go back to PAYMENT_READY
  // so payment scheduling runs clean and PENDING_APPROVAL gets a fresh sign-off.
  // EXCEPTION_REVIEW can NEVER go directly to APPROVED.
  EXCEPTION_REVIEW: [
    "EXCEPTION_REVIEW",
    "PAYMENT_READY",
    "BLOCKED",
    "WAITING_INFO"
  ],

  APPROVED: ["ACCOUNTING"],

  ACCOUNTING: ["ACCOUNTING", "COMPLETED", "EXCEPTION_REVIEW", "BLOCKED"]
};

async function logAudit(invoice_id, organization_id, old_state, new_state, reason = null) {
  await pool.query(
    `INSERT INTO audit_event_log
     (invoice_id, organization_id, old_state, new_state, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [invoice_id, organization_id, old_state, new_state, reason || null]
  );
}

async function processInvoice(invoice_id, organization_id) {

  const stateRes = await pool.query(
    `SELECT current_state, retry_count
     FROM invoice_state_machine
     WHERE invoice_id = $1
     AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!stateRes.rows.length) {
    console.log("State not found:", invoice_id);
    return;
  }

  let { current_state, retry_count } = stateRes.rows[0];

  console.log("Current State:", current_state);

  if (
    current_state === "COMPLETED" ||
    current_state === "BLOCKED" ||
    current_state === "WAITING_INFO"
  )  {
    console.log("Processing paused at:", current_state);
    return;
  }

  try {

    const config = await PolicyEngine.loadAllConfigs(organization_id);

    const context = {
      invoice_id,
      organization_id,
      config
    };

    const supervisor = new SupervisorAgent(context);
    const result = await supervisor.executeStep();

    if (!result?.decision) {
      console.log("No decision returned.");
      return;
    }

    const decision = result.decision;

    // ── Retry path ────────────────────────────────────────────────
    if (decision.retry === true) {

      const maxRetry = context.config?.payment?.max_retry_count ?? 2;

      if (retry_count >= maxRetry) {

        await pool.query(
          `UPDATE invoice_state_machine
           SET current_state = 'BLOCKED',
               last_updated = NOW()
           WHERE invoice_id = $1
           AND organization_id = $2`,
          [invoice_id, organization_id]
        );

        await logAudit(invoice_id, organization_id, current_state, "BLOCKED", "RETRY_LIMIT_EXCEEDED");
        console.log("Retry limit exceeded. Blocked.");
        return;
      }

      await pool.query(
        `UPDATE invoice_state_machine
         SET retry_count = retry_count + 1,
             last_updated = NOW()
         WHERE invoice_id = $1
         AND organization_id = $2`,
        [invoice_id, organization_id]
      );

      console.log("Retry incremented.");
      return;
    }

    if (!decision.nextState) {
      console.log("No nextState provided.");
      return;
    }

    // ── State transition guard ────────────────────────────────────
    const allowed = STATE_TRANSITIONS[current_state] || [];

    if (!allowed.includes(decision.nextState)) {
      throw new Error(
        `Illegal transition from ${current_state} to ${decision.nextState}`
      );
    }

    // ── Update state machine ──────────────────────────────────────
    // Increment review_cycle atomically when moving TO EXCEPTION_REVIEW
    if (decision.nextState === "EXCEPTION_REVIEW") {
      await pool.query(
        `UPDATE invoice_state_machine
         SET current_state  = $1,
             retry_count    = 0,
             last_updated   = NOW(),
             review_cycle   = review_cycle + 1
         WHERE invoice_id      = $2
         AND   organization_id = $3`,
        [decision.nextState, invoice_id, organization_id]
      );
    } else {
      await pool.query(
        `UPDATE invoice_state_machine
         SET current_state  = $1,
             retry_count    = 0,
             last_updated   = NOW()
         WHERE invoice_id      = $2
         AND   organization_id = $3`,
        [decision.nextState, invoice_id, organization_id]
      );
    }

    await logAudit(invoice_id, organization_id, current_state, decision.nextState, decision.reason || null);

    console.log("Moved to:", decision.nextState);

    // ── WAITING_INFO: notify vendor ───────────────────────────────
    if (decision.nextState === "WAITING_INFO") {
      await NotificationWorker.execute({
        invoice_id,
        organization_id,
        reason: decision.reason
      });
      return;
    }

    // ── Re-emit logic ─────────────────────────────────────────────
    // Stop at: BLOCKED, COMPLETED, EXCEPTION_REVIEW, PENDING_APPROVAL
    // These all require external action before processing continues.
    // Everything else re-emits immediately to keep the pipeline moving.
    if (
      decision.nextState !== "BLOCKED" &&
      decision.nextState !== "COMPLETED" &&
      decision.nextState !== "EXCEPTION_REVIEW" &&
      decision.nextState !== "PENDING_APPROVAL"
    ) {
      await redis.xAdd("invoice_events", "*", { invoice_id, organization_id });
    }

  } catch (err) {

    console.error(`Supervisor failure [${invoice_id}]:`, err.message);

    await pool.query(
      `UPDATE invoice_state_machine
       SET retry_count = retry_count + 1,
           last_updated = NOW()
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, organization_id]
    );
  }
}

async function runReflectionCycle() {
  try {
    await reflectionService.reflect();
  } catch (err) {
    console.error("ReflectionService error:", err.message);
  }
}

async function listen() {

  console.log("Orchestrator running...");

  while (true) {

    try {

      const response = await redis.xReadGroup(
        "orchestrator_group",
        "orchestrator_1",
        { key: "invoice_events", id: ">" },
        { COUNT: 1, BLOCK: 5000 }
      );

      if (!response) continue;

      const message = response[0].messages[0];
      const { invoice_id, organization_id } = message.message;

      console.log("Event received:", invoice_id);

      await processInvoice(invoice_id, organization_id);

      await redis.xAck("invoice_events", "orchestrator_group", message.id);

      await runReflectionCycle();

    } catch (error) {
      console.error("Listener Error:", error);
    }
  }
}

try {
  await redis.xGroupCreate("invoice_events", "orchestrator_group", "0", {
    MKSTREAM: true
  });
} catch (err) {
  if (!err.message.includes("BUSYGROUP")) throw err;
}

await listen();