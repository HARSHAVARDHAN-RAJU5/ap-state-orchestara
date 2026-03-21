import pool from "../db.js";

// How many failures in the same state before we trip the circuit breaker
const CIRCUIT_BREAKER_THRESHOLD = 2;

// States where repeated failure means route to EXCEPTION_REVIEW with context
// instead of retrying the same worker again
const REFLECTABLE_STATES = [
  "VALIDATING",
  "MATCHING",
  "FRAUD_SCREENING",
  "COMPLIANCE",
  "PAYMENT_READY",
  "PENDING_APPROVAL",
  "ACCOUNTING"
];

// States we never act on — either terminal, waiting for external input, or
// already in human review
const NON_REFLECTABLE_STATES = [
  "RECEIVED",
  "STRUCTURED",
  "DUPLICATE_CHECK",
  "EXCEPTION_REVIEW",
  "WAITING_INFO",
  "BLOCKED",
  "COMPLETED"
];

export class ReflectionService {

  // Called by orchestrator on each cycle.
  // Finds invoices stuck in the same state with repeated failures
  // and trips the circuit breaker → routes to EXCEPTION_REVIEW.
  async reflect() {

    const stuckInvoices = await this.findStuckInvoices();

    for (const invoice of stuckInvoices) {
      await this.tripCircuitBreaker(invoice);
    }
  }

  // Find invoices that have failed the same state >= CIRCUIT_BREAKER_THRESHOLD times
  // and have NOT already been routed to EXCEPTION_REVIEW by us.
  async findStuckInvoices() {

    const res = await pool.query(
      `SELECT
         ism.invoice_id,
         ism.organization_id,
         ism.current_state,
         COUNT(aal.id) AS failure_count,
         MAX(aal.created_at) AS last_failure_at
       FROM invoice_state_machine ism
       JOIN agent_action_log aal
         ON aal.invoice_id = ism.invoice_id
        AND aal.organization_id = ism.organization_id
        AND aal.action = 'ERROR'
        AND aal.state_name = ism.current_state
        AND aal.success = false
       WHERE ism.current_state = ANY($1)
       GROUP BY ism.invoice_id, ism.organization_id, ism.current_state
       HAVING COUNT(aal.id) >= $2`,
      [REFLECTABLE_STATES, CIRCUIT_BREAKER_THRESHOLD]
    );

    return res.rows;
  }

  // Trip the circuit breaker for a stuck invoice.
  // Moves it to EXCEPTION_REVIEW with full failure context so the human
  // (or ExceptionReviewAgent auto-resolve) knows exactly what happened.
  async tripCircuitBreaker(invoice) {

    const { invoice_id, organization_id, current_state, failure_count } = invoice;

    // Check it hasn't already been tripped this cycle —
    // look for a recent circuit breaker audit entry
    const alreadyTripped = await pool.query(
      `SELECT 1 FROM audit_event_log
       WHERE invoice_id = $1
         AND organization_id = $2
         AND reason LIKE 'Circuit breaker:%'
         AND new_state = 'EXCEPTION_REVIEW'
         AND created_at > NOW() - INTERVAL '1 hour'
       LIMIT 1`,
      [invoice_id, organization_id]
    );

    if (alreadyTripped.rows.length) return;

    const reason = `Circuit breaker: failed ${failure_count}x in ${current_state} — routed for human review`;

    // Move to EXCEPTION_REVIEW
    await pool.query(
      `UPDATE invoice_state_machine
       SET current_state = 'EXCEPTION_REVIEW',
           last_updated = NOW()
       WHERE invoice_id = $1
         AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    // Write audit trail — this is what the dashboard and ExceptionReviewAgent
    // will use to understand why this invoice is in EXCEPTION_REVIEW
    await pool.query(
      `INSERT INTO audit_event_log
         (invoice_id, organization_id, old_state, new_state, reason)
       VALUES ($1, $2, $3, 'EXCEPTION_REVIEW', $4)`,
      [invoice_id, organization_id, current_state, reason]
    );

    // Write a reflection log entry — failure_patterns table for future
    // agent memory reads (groundwork for LangGraph migration)
    await pool.query(
      `INSERT INTO agent_reflection_log
         (invoice_id, organization_id, state, reflection, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [
        invoice_id,
        organization_id,
        current_state,
        JSON.stringify({
          type: "CIRCUIT_BREAKER_TRIPPED",
          failure_count,
          state: current_state,
          tripped_at: new Date().toISOString()
        })
      ]
    );
  }

  // Called by agents before processing — reads back failure patterns for this
  // invoice so the agent has context on what has already been tried.
  // Currently returns the raw log; agents can use it in their plan() step.
  // This is the groundwork for LangGraph agent memory.
  static async getFailureContext(invoice_id, organization_id) {

    const res = await pool.query(
      `SELECT state, reflection, created_at
       FROM agent_reflection_log
       WHERE invoice_id = $1
         AND organization_id = $2
       ORDER BY created_at DESC
       LIMIT 10`,
      [invoice_id, organization_id]
    );

    return res.rows.map(r => ({
      state: r.state,
      ...JSON.parse(r.reflection),
      at: r.created_at
    }));
  }
}

export default new ReflectionService();
