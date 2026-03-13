import BaseAgent from "./BaseAgent.js";
import * as DuplicateWorker from "../workers/DuplicateWorker.js";

export default class DuplicateAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return {
      action: "RUN_DUPLICATE_CHECK"
    };
  }

  async act(plan) {
    return await DuplicateWorker.execute(this.context);
  }

  async evaluate(observation) {

    if (!observation || observation.success === false) {
      return {
        nextState: "BLOCKED",
        reason: observation?.reason || "Duplicate check failed"
      };
    }

    switch (observation.outcome) {

      case "NO_DUPLICATE":
        return {
          nextState: "VALIDATING",
          reason: "No duplicate detected"
        };

      case "DUPLICATE_CONFIRMED":
        return {
          nextState: "BLOCKED",
          reason: "Duplicate invoice confirmed"
        };

      case "POTENTIAL_DUPLICATE":
        return {
          nextState: "EXCEPTION_REVIEW",
          reason: "Potential duplicate requires manual review"
        };

      case "DATA_MISSING":
        return {
          nextState: "WAITING_INFO",
          reason: observation.reason || "Extraction data missing"
        };

      case "ALREADY_PAID_DUPLICATE":
        return {
        nextState: "BLOCKED",
        reason: "Invoice already paid earlier"
        };

      default:
        return {
          nextState: "BLOCKED",
          reason: "Unhandled duplicate state"
        };
    }
  }
}