import BaseAgent from "./BaseAgent.js";
import * as Worker from "../workers/MatchingWorker.js";

export default class MatchingAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return { action: "RUN_PO_MATCHING" };
  }

  async act() {
    return await Worker.execute(this.context);
  }

  async evaluate(result) {

    if (!result?.success) {
      return {
        nextState: "BLOCKED",
        reason: result?.reason || "Matching failed"
      };
    }

    const {
      missing_po_flag,
      price_variance_flag,
      bank_mismatch_flag
    } = result.signals;

    if (bank_mismatch_flag) {
      return {
        nextState: "WAITING_INFO",
        reason: "Vendor bank account mismatch"
      };
    }

    if (missing_po_flag) {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "No matching purchase order"
      };
    }

    if (price_variance_flag) {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "Invoice amount exceeds PO tolerance"
      };
    }

    return {
      nextState: "COMPLIANCE",
      reason: "PO matching successful"
    };
  }
}