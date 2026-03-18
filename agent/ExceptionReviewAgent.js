import BaseAgent from "./BaseAgent.js";
import * as ExceptionReviewWorker from "../workers/ExceptionReviewWorker.js";

// Thresholds
const AUTO_APPROVE_SCORE  = 30;  // below this → auto-approve, no human needed
const AUTO_BLOCK_SCORE    = 60;  // above this → auto-block, safety net
const ESCALATE_HOURS      = 4;   // hours waiting before escalating medium risk

export default class ExceptionReviewAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return { action: "CHECK_REVIEW_DECISION" };
  }

  async act(plan) {
    if (plan.action !== "CHECK_REVIEW_DECISION") {
      throw new Error("Unknown action for ExceptionReviewAgent");
    }
    return await ExceptionReviewWorker.execute(this.context);
  }

  async evaluate(observation) {

    const { invoice_id, organization_id } = this.context;

    if (!observation?.success) {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "Decision lookup failed"
      };
    }

    // ── Human decision found — process it ─────────────────────────
    if (observation.decisionFound) {

      await ExceptionReviewWorker.markDecisionProcessed(
        observation.decisionId,
        organization_id
      );

      if (observation.decision === "APPROVE") {
        return { nextState: "APPROVED", reason: "Approved by reviewer" };
      }

      if (observation.decision === "ESCALATE") {
        return { nextState: "EXCEPTION_REVIEW", reason: "Escalated for further review" };
      }

      if (observation.decision === "BLOCK") {
        return {
          nextState: "BLOCKED",
          reason: observation.reason || "Blocked by reviewer"
        };
      }

      return { nextState: "EXCEPTION_REVIEW", reason: "Invalid reviewer decision" };
    }

    // ── No human decision — attempt auto-resolve ───────────────────
    const { fraudScore, hasFraudScore, hoursWaiting } = observation;

    // Came from validation/matching path — no fraud score, keep waiting
    if (!hasFraudScore) {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "Waiting for reviewer decision"
      };
    }

    // Low risk — auto-approve, no human needed
    if (fraudScore < AUTO_APPROVE_SCORE) {
      return {
        nextState: "APPROVED",
        reason: `Auto-approved — low fraud risk score: ${fraudScore}`
      };
    }

    // High risk — auto-block, safety net
    if (fraudScore >= AUTO_BLOCK_SCORE) {
      return {
        nextState: "BLOCKED",
        reason: `Auto-blocked — high fraud risk score: ${fraudScore}`
      };
    }

    // Medium risk — wait up to ESCALATE_HOURS then escalate
    if (hoursWaiting >= ESCALATE_HOURS) {
      await ExceptionReviewWorker.escalateApprover(invoice_id, organization_id);
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: `Escalated — no decision after ${Math.round(hoursWaiting)} hours. Risk score: ${fraudScore}`
      };
    }

    // Medium risk, still within wait window — keep waiting
    return {
      nextState: "EXCEPTION_REVIEW",
      reason: `Waiting for reviewer — risk score: ${fraudScore}, waiting ${Math.round(hoursWaiting)}h of ${ESCALATE_HOURS}h`
    };
  }
}