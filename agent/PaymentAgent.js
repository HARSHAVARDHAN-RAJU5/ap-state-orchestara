import BaseAgent from "./BaseAgent.js";
import * as PaymentWorker from "../workers/PaymentWorker.js";

export default class PaymentAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return {
      action: "RUN_PAYMENT_SCHEDULING"
    };
  }

  async act() {
    return await PaymentWorker.execute(this.context);
  }

  async evaluate(result) {

    if (!result?.success) {
      return {
        retry: true,
        reason: result?.reason || "Payment scheduling failed"
      };
    }

    return {
      nextState: result.nextState,
      reason: "Payment scheduled successfully"
    };
  }
}