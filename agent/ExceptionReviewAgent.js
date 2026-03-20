import BaseAgent from "./BaseAgent.js";
import * as ExceptionReviewWorker from "../workers/ExceptionReviewWorker.js";

const AUTO_APPROVE_SCORE = 30;
const AUTO_BLOCK_SCORE   = 60;
const ESCALATE_HOURS     = 4;

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
      return { nextState: "EXCEPTION_REVIEW", reason: "Decision lookup failed" };
    }

    // ── Human decision found ───────────────────────────────────────
    if (observation.decisionFound) {

      // APPROVE resolves the exception — route back to PAYMENT_READY
      // so payment scheduling reruns and PENDING_APPROVAL gets a fresh
      // sign-off. EXCEPTION_REVIEW can NEVER go directly to APPROVED.
      if (observation.decision === "APPROVE") {
        return { nextState: "PAYMENT_READY", reason: "Exception resolved by reviewer" };
      }

      if (observation.decision === "ESCALATE") {
        return { nextState: "EXCEPTION_REVIEW", reason: "Escalated for further review" };
      }

      if (observation.decision === "BLOCK") {
        return { nextState: "BLOCKED", reason: observation.reason || "Blocked by reviewer" };
      }

      return { nextState: "EXCEPTION_REVIEW", reason: "Invalid reviewer decision" };
    }

    // ── No human decision — attempt auto-resolve ───────────────────
    const { fraudScore, hasFraudScore, hoursWaiting, alreadyAutoResolved, review_cycle } = observation;

    // Already auto-resolved this cycle — wait for human
    if (alreadyAutoResolved) {
      return { nextState: "EXCEPTION_REVIEW", reason: "Waiting for reviewer decision" };
    }

    // No fraud score — came from validation/matching/duplicate path
    if (!hasFraudScore) {
      return { nextState: "EXCEPTION_REVIEW", reason: "Waiting for reviewer decision" };
    }

    // Low risk — auto-resolve exception, route to PAYMENT_READY
    if (fraudScore < AUTO_APPROVE_SCORE) {
      await ExceptionReviewWorker.markAutoResolved(invoice_id, organization_id, review_cycle);
      return { nextState: "PAYMENT_READY", reason: `Auto-resolved — low fraud risk score: ${fraudScore}` };
    }

    // High risk — auto-block
    if (fraudScore >= AUTO_BLOCK_SCORE) {
      await ExceptionReviewWorker.markAutoResolved(invoice_id, organization_id, review_cycle);
      return { nextState: "BLOCKED", reason: `Auto-blocked — high fraud risk score: ${fraudScore}` };
    }

    // Medium risk — wait up to ESCALATE_HOURS then escalate
    if (hoursWaiting >= ESCALATE_HOURS) {
      await ExceptionReviewWorker.escalateApprover(invoice_id, organization_id);
      await ExceptionReviewWorker.markAutoResolved(invoice_id, organization_id, review_cycle);
      return { nextState: "EXCEPTION_REVIEW", reason: `Escalated — no decision after ${Math.round(hoursWaiting)} hours. Risk score: ${fraudScore}` };
    }

    // Medium risk, within wait window — keep waiting
    return { nextState: "EXCEPTION_REVIEW", reason: `Waiting for reviewer — risk score: ${fraudScore}, waiting ${Math.round(hoursWaiting)}h of ${ESCALATE_HOURS}h` };
  }
}