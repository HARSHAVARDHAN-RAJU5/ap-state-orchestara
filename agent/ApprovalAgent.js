import BaseAgent from "./BaseAgent.js";
import * as ApprovalWorker from "../workers/ApprovalWorker.js";

export default class ApprovalAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return {
      action: "RUN_APPROVAL_ROUTING"
    };
  }

  async act() {
    return await ApprovalWorker.execute(this.context);
  }

  async evaluate(observation) {

    if (!observation?.success) {
      return {
        nextState: "BLOCKED",
        reason: observation?.reason || "Approval routing failed"
      };
    }

    const levels = this.config?.approval?.levels || [];
    if (!levels.length) {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "Approval levels not configured for this organization — admin action required"
      };
    }

    const lowestTier = Math.min(...levels.map(l => l.min_amount));
    if (observation.invoiceTotal < lowestTier) {
      return {
      nextState: "APPROVED",
      reason: "Below minimum approval threshold — auto approved"
    };
  }

    return {
      nextState: "EXCEPTION_REVIEW",
      reason: "Invoice routed for human approval"
    };
  }}