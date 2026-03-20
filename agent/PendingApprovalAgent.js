import BaseAgent from "./BaseAgent.js";
import * as PendingApprovalWorker from "../workers/PendingApprovalWorker.js";

export default class PendingApprovalAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return { action: "CHECK_PAYMENT_APPROVAL" };
  }

  async act(plan) {
    if (plan.action !== "CHECK_PAYMENT_APPROVAL") {
      throw new Error("Unknown action for PendingApprovalAgent");
    }
    return await PendingApprovalWorker.execute(this.context);
  }

  async evaluate(observation) {

    if (!observation?.success) {
      return {
        nextState: "PENDING_APPROVAL",
        reason: "Approval decision lookup failed"
      };
    }

    // No decision yet — keep waiting
    if (!observation.decisionFound) {
      return {
        nextState: "PENDING_APPROVAL",
        reason: "Waiting for payment approval decision"
      };
    }

    // APPROVE — payment approved, move to accounting
    if (observation.decision === "APPROVE") {
      return {
        nextState: "APPROVED",
        reason: `Payment approved by ${observation.reviewer_name} (${observation.reviewer_role})`
      };
    }

    // REJECT — escalate to exception review for superior sign-off
    if (observation.decision === "REJECT") {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: `Payment rejected by ${observation.reviewer_name} (${observation.reviewer_role}). ${observation.reason || ""}`
      };
    }

    return {
      nextState: "PENDING_APPROVAL",
      reason: "Invalid approval decision"
    };
  }
}