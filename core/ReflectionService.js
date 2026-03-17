import pool from "../db.js";

// FIX T4-2: Only run reflection logic for states that actually have rules.
// Previously reflect() ran 2-3 DB queries on every single processInvoice()
// cycle regardless of state. Reflection rules only exist for MATCHING and
// VALIDATING — all other states were doing pointless DB work and returning null.
const REFLECTABLE_STATES = ["MATCHING", "VALIDATING"];

async function updateFailurePattern(organization_id, vendor_id, failure_type) {

  const existing = await pool.query(
    `SELECT id, occurrence_count
     FROM failure_patterns
     WHERE organization_id = $1
       AND vendor_id = $2
       AND failure_type = $3`,
    [organization_id, vendor_id, failure_type]
  );

  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE failure_patterns
       SET occurrence_count = occurrence_count + 1,
           last_occurrence = NOW()
       WHERE id = $1`,
      [existing.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO failure_patterns
       (organization_id, vendor_id, failure_type, occurrence_count, last_occurrence)
       VALUES ($1, $2, $3, 1, NOW())`,
      [organization_id, vendor_id, failure_type]
    );
  }
}

export async function reflect(context, currentState) {

  // Early exit — no reflection rules exist for this state, skip all DB queries
  if (!REFLECTABLE_STATES.includes(currentState)) {
    return null;
  }

  const { invoice_id, organization_id } = context;

  try {

    const vendorRes = await pool.query(
      `SELECT vendor_id
       FROM invoice_validation_results
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    if (!vendorRes.rows.length) {
      return null;
    }

    const vendor_id = vendorRes.rows[0].vendor_id;

    const history = await pool.query(
      `SELECT action, output, error_message, success
       FROM agent_action_log
       WHERE invoice_id = $1
         AND organization_id = $2
       ORDER BY created_at DESC
       LIMIT 5`,
      [invoice_id, organization_id]
    );

    if (!history.rows.length) {
      return null;
    }

    const failures = history.rows.filter(r => r.success === false);

    let reflectionResult = null;

    if (failures.length >= 2) {

      if (currentState === "MATCHING") {

        await updateFailurePattern(
          organization_id,
          vendor_id,
          "MATCHING_FAILURE"
        );

        reflectionResult = {
          risk_score: null,
          decision_summary: "Repeated matching failure",
          overrideState: "EXCEPTION_REVIEW"
        };
      }

      if (currentState === "VALIDATING") {

        await updateFailurePattern(
          organization_id,
          vendor_id,
          "VALIDATION_FAILURE"
        );

        reflectionResult = {
          risk_score: null,
          decision_summary: "Repeated validation failure",
          overrideState: "WAITING_INFO"
        };
      }
    }

    if (reflectionResult) {

      await pool.query(
        `INSERT INTO agent_reflection_log
         (invoice_id, organization_id, state, risk_score, decision_summary, override_state)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          invoice_id,
          organization_id,
          currentState,
          reflectionResult.risk_score,
          reflectionResult.decision_summary,
          reflectionResult.overrideState
        ]
      );

      return reflectionResult;
    }

    return null;

  } catch (error) {
    console.error("Reflection error:", error.message);
    return null;
  }
}