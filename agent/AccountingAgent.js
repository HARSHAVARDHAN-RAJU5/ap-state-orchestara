import BaseAgent from "./BaseAgent.js";
import AccountingWorker from "../workers/AccountingWorker.js";

export default class AccountingAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return { action: "RUN_ACCOUNTING" };
  }

  async act() {
    return await AccountingWorker.run(this.context);
  }

  async evaluate(result) {

    if (!result?.nextState) {
      return {
        nextState: "BLOCKED",
        reason: "Accounting worker returned no state"
      };
    }

    return {
      nextState: result.nextState,
      reason: result.reason || "Accounting step completed"
    };
  }
}