import { createClient } from "redis";
import pool from "./db.js";
import dotenv from "dotenv";
dotenv.config();

import SupervisorAgent from "./agent/SupervisorAgent.js";
import * as NotificationWorker from "./workers/NotificationWorker.js";
import PolicyEngine from "./core/PolicyEngine.js";
import { reflect } from "./core/ReflectionService.js";
import AccountingWorker from "./workers/AccountingWorker.js";

const redis = createClient({
  url: "redis://127.0.0.1:6379"
});

redis.on("error", (err) => {
  console.error("Redis Error:", err);
});

const STATE_TRANSITIONS = {

  RECEIVED: ["STRUCTURED", "WAITING_INFO"],

  STRUCTURED: ["DUPLICATE_CHECK", "BLOCKED"],

  DUPLICATE_CHECK: ["VALIDATING", "BLOCKED"],

  VALIDATING: ["MATCHING", "WAITING_INFO", "BLOCKED", "EXCEPTION_REVIEW"],

  MATCHING: [
    "COMPLIANCE",
    "WAITING_INFO",
    "EXCEPTION_REVIEW",
    "BLOCKED"
  ],

  COMPLIANCE: [
    "PAYMENT_READY",
    "EXCEPTION_REVIEW",
    "BLOCKED"
  ],

  PAYMENT_READY: ["EXCEPTION_REVIEW"],

  WAITING_INFO: ["RECEIVED"],

  EXCEPTION_REVIEW: [
    "APPROVED",
    "BLOCKED",
    "WAITING_INFO"
  ],

  APPROVED: ["ACCOUNTING"],

  ACCOUNTING: [
    "PAYMENT_EXECUTION",
    "EXCEPTION_REVIEW"
  ],

  PAYMENT_EXECUTION: [
    "COMPLETED",
    "BLOCKED"
  ]

};

async function logAudit(
  invoice_id,
  organization_id,
  old_state,
  new_state,
  reason = null
) {

  await pool.query(
    `
    INSERT INTO audit_event_log
    (invoice_id, organization_id, old_state, new_state, reason)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [invoice_id, organization_id, old_state, new_state, reason || null]
  );
}

async function processInvoice(invoice_id, organization_id) {

  const stateRes = await pool.query(
    `
    SELECT current_state, retry_count
    FROM invoice_state_machine
    WHERE invoice_id = $1
    AND organization_id = $2
    `,
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
  ) {
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

    const reflection = await reflect(context, current_state);

    if (reflection?.overrideState) {

      const allowed = STATE_TRANSITIONS[current_state] || [];

      if (allowed.includes(reflection.overrideState)) {

        await pool.query(
          `
          UPDATE invoice_state_machine
          SET current_state = $1,
              retry_count = 0,
              last_updated = NOW()
          WHERE invoice_id = $2
          AND organization_id = $3
          `,
          [reflection.overrideState, invoice_id, organization_id]
        );

        await logAudit(
          invoice_id,
          organization_id,
          current_state,
          reflection.overrideState,
          reflection.reason || "Reflection override"
        );

        console.log("Reflection override to:", reflection.overrideState);

        await redis.xAdd("invoice_events", "*", {
          invoice_id,
          organization_id
        });

        return;
      }
    }

    const supervisor = new SupervisorAgent(context);
    const result = await supervisor.executeStep();

    if (!result?.decision) {
      console.log("No decision returned.");
      return;
    }

    const decision = result.decision;

    if (decision.retry === true) {

      const maxRetry =
        context.config?.payment?.max_retry_count ?? 2;

      if (retry_count >= maxRetry) {

        await pool.query(
          `
          UPDATE invoice_state_machine
          SET current_state = 'BLOCKED',
              last_updated = NOW()
          WHERE invoice_id = $1
          AND organization_id = $2
          `,
          [invoice_id, organization_id]
        );

        await logAudit(
          invoice_id,
          organization_id,
          current_state,
          "BLOCKED",
          "RETRY_LIMIT_EXCEEDED"
        );

        console.log("Retry limit exceeded. Blocked.");
        return;
      }

      await pool.query(
        `
        UPDATE invoice_state_machine
        SET retry_count = retry_count + 1,
            last_updated = NOW()
        WHERE invoice_id = $1
        AND organization_id = $2
        `,
        [invoice_id, organization_id]
      );

      console.log("Retry incremented.");
      return;
    }

    if (!decision.nextState) {
      console.log("No nextState provided.");
      return;
    }

    if (decision.nextState === current_state) {
      console.log("No state change.");
      return;
    }

    const allowed = STATE_TRANSITIONS[current_state] || [];

    if (!allowed.includes(decision.nextState)) {
      throw new Error(
        `Illegal transition from ${current_state} to ${decision.nextState}`
      );
    }

    await pool.query(
      `
      UPDATE invoice_state_machine
      SET current_state = $1,
          retry_count = 0,
          last_updated = NOW()
      WHERE invoice_id = $2
      AND organization_id = $3
      `,
      [decision.nextState, invoice_id, organization_id]
    );

    await logAudit(
      invoice_id,
      organization_id,
      current_state,
      decision.nextState,
      decision.reason || null
    );

    console.log("Moved to:", decision.nextState);

    if (decision.nextState === "ACCOUNTING") {

      try {

        await AccountingWorker.postAccrual(context);

        await pool.query(
          `
          UPDATE invoice_state_machine
          SET current_state = 'PAYMENT_EXECUTION',
              last_updated = NOW()
          WHERE invoice_id = $1
          AND organization_id = $2
          `,
          [invoice_id, organization_id]
        );

        await logAudit(
          invoice_id,
          organization_id,
          "ACCOUNTING",
          "PAYMENT_EXECUTION",
          "Accrual posted"
        );

        await redis.xAdd("invoice_events", "*", {
          invoice_id,
          organization_id
        });

        return;

      } catch (err) {

        console.error("Accounting failure:", err.message);

        await pool.query(
          `
          UPDATE invoice_state_machine
          SET current_state = 'EXCEPTION_REVIEW',
              last_updated = NOW()
          WHERE invoice_id = $1
          AND organization_id = $2
          `,
          [invoice_id, organization_id]
        );

        await logAudit(
          invoice_id,
          organization_id,
          "ACCOUNTING",
          "EXCEPTION_REVIEW",
          "ACCOUNTING_FAILURE"
        );

        return;
      }
    }

    if (decision.nextState === "WAITING_INFO") {

      await NotificationWorker.execute({
        invoice_id,
        organization_id,
        reason: decision.reason
      });

      return;
    }

    if (
      decision.nextState !== "BLOCKED" &&
      decision.nextState !== "COMPLETED"
    ) {

      await redis.xAdd("invoice_events", "*", {
        invoice_id,
        organization_id
      });

    }

  } catch (err) {

    console.error("Supervisor failure:", err.message);

    await pool.query(
      `
      UPDATE invoice_state_machine
      SET retry_count = retry_count + 1,
          last_updated = NOW()
      WHERE invoice_id = $1
      AND organization_id = $2
      `,
      [invoice_id, organization_id]
    );
  }
}

async function listen() {

  console.log("Orchestrator running...");

  while (true) {

    try {

      const response = await redis.xReadGroup(
        "orchestrator_group",
        "orchestrator_1",
        {
          key: "invoice_events",
          id: ">"
        },
        {
          COUNT: 1,
          BLOCK: 5000
        }
      );

      if (!response) continue;

      const message = response[0].messages[0];
      const { invoice_id, organization_id } = message.message;

      console.log("Event received:", invoice_id);

      await processInvoice(invoice_id, organization_id);

      await redis.xAck(
        "invoice_events",
        "orchestrator_group",
        message.id
      );

    } catch (error) {

      console.error("Listener Error:", error);

    }
  }
}

async function start() {

  await redis.connect();
  await listen();

}

start();