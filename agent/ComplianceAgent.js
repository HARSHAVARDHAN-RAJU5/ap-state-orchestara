import BaseAgent from "./BaseAgent.js";
import * as Worker from "../workers/ComplianceWorker.js";

export default class ComplianceAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return { action: "RUN_COMPLIANCE_CHECKS" };
  }

  async act() {
    return await Worker.execute(this.context);
  }

  async evaluate(result) {

    if (!result?.success) {
      return {
        nextState: "BLOCKED",
        reason: result?.reason || "Compliance execution failed"
      };
    }

    const {
      tax_status,
      high_value_flag
    } = result.signals;

    if (tax_status === "FAIL") {
      return {
        nextState: "BLOCKED",
        reason: "Invoice failed tax compliance checks"
      };
    }

    if (high_value_flag) {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: "Invoice exceeds approval threshold"
      };
    }

    return {
      nextState: "PENDING_APPROVAL",
      reason: "Invoice passed compliance checks"
    };
  }
}