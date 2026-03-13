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

    return {
      nextState: "EXCEPTION_REVIEW",
      reason: "Invoice routed for human approval"
    };
  }
}