import BaseAgent from "./BaseAgent.js";
import * as FraudScoringWorker from "../workers/FraudScoringWorker.js";

export default class FraudScoringAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return { action: "RUN_FRAUD_SCORING" };
  }

  async act() {
    return await FraudScoringWorker.execute(this.context);
  }

  async evaluate(result) {

    if (!result?.success) {
      return {
        nextState: "BLOCKED",
        reason: result?.reason || "Fraud scoring failed"
      };
    }

    const { outcome, risk_score, signals } = result;

    const signalNames = signals.map(s => s.signal).join(", ");

    if (outcome === "PASS") {
      return {
        nextState: "COMPLIANCE",
        reason: `Fraud check passed — risk score: ${risk_score}`
      };
    }

    if (outcome === "REVIEW") {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: `Fraud review required — risk score: ${risk_score}. Signals: ${signalNames}`
      };
    }

    // outcome === "BLOCK"
    return {
      nextState: "BLOCKED",
      reason: `High fraud risk — score: ${risk_score}. Signals: ${signalNames}`
    };
  }
}