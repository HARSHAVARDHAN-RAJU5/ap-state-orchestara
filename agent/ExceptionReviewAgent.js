import BaseAgent from "./BaseAgent.js";
import pool from "../db.js";

export default class ExceptionReviewAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return {
      action: "CHECK_REVIEW_DECISION"
    };
  }

  async act(plan) {

    if (plan.action !== "CHECK_REVIEW_DECISION") {
      throw new Error("Unknown action for ExceptionReviewAgent");
    }

    const { invoice_id, organization_id } = this.context;

    const res = await pool.query(
      `
      SELECT id, decision, reason
      FROM exception_review_decisions
      WHERE invoice_id = $1
      AND organization_id = $2
      AND processed = false
      ORDER BY decided_at DESC
      LIMIT 1
      `,
      [invoice_id, organization_id]
    );

    if (!res.rows.length) {
      return {
        success: true,
        decisionFound: false
      };
    }

    return {
      success: true,
      decisionFound: true,
      decision: res.rows[0].decision,
      decisionId: res.rows[0].id,
      reason: res.rows[0].reason
    };

  }

  async evaluate(observation) {

    const { invoice_id, organization_id } = this.context;

    if (!observation?.success) {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "Decision lookup failed"
      };
    }

    if (!observation.decisionFound) {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "Waiting for reviewer decision"
      };
    }

    // mark decision as processed
    await pool.query(
      `
      UPDATE exception_review_decisions
      SET processed = true
      WHERE id = $1
      AND organization_id = $2
      `,
      [observation.decisionId, organization_id]
    );

    if (observation.decision === "APPROVE") {

      return {
        nextState: "APPROVED",
        reason: "Approved by reviewer"
      };

    }

    if (observation.decision === "ESCALATE") {

      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "Escalated for further review"
      };

    }

    if (observation.decision === "BLOCK") {

      return {
        nextState: "BLOCKED",
        reason: observation.reason || "Blocked by reviewer"
      };

    }

    return {
      nextState: "EXCEPTION_REVIEW",
      reason: "Invalid reviewer decision"
    };

  }

}