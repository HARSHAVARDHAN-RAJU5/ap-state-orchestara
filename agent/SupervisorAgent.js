import pool from "../db.js";

import IntakeExtractionAgent from "./IntakeExtractionAgent.js";
import DuplicateAgent from "./DuplicateAgent.js";
import ValidationAgent from "./ValidationAgent.js";
import MatchingAgent from "./MatchingAgent.js";
import ComplianceAgent from "./ComplianceAgent.js";
import PaymentAgent from "./PaymentAgent.js";
import ExceptionReviewAgent from "./ExceptionReviewAgent.js";
import AccountingAgent from "./AccountingAgent.js";

export default class SupervisorAgent {

  constructor(context) {
    this.context = context;
    this.invoice_id = context.invoice_id;
    this.organization_id = context.organization_id;
    this.config = context.config;
  }

  async getCurrentState() {

    const res = await pool.query(
      `
      SELECT current_state
      FROM invoice_state_machine
      WHERE invoice_id = $1
      AND organization_id = $2
      `,
      [this.invoice_id, this.organization_id]
    );

    if (!res.rows.length) {
      throw new Error("Invoice state not found");
    }

    return res.rows[0].current_state;
  }

  selectAgent(state) {

    switch (state) {

      case "RECEIVED":
        return new IntakeExtractionAgent(this.context);

      case "STRUCTURED":
        return {
          run: async () => ({
            nextState: "DUPLICATE_CHECK",
            reason: "Extraction completed"
          })
        };

      case "DUPLICATE_CHECK":
        return new DuplicateAgent(this.context);

      case "VALIDATING":
        return new ValidationAgent(this.context);

      case "MATCHING":
        return new MatchingAgent(this.context);

      case "COMPLIANCE":
        return new ComplianceAgent(this.context);

      case "PAYMENT_READY":
        return new PaymentAgent(this.context);

      case "EXCEPTION_REVIEW":
        return new ExceptionReviewAgent(this.context);

      case "ACCOUNTING":
        return new AccountingAgent(this.context);

      case "APPROVED":
        return {
          run: async () => ({
            nextState: "ACCOUNTING",
            reason: "Invoice approved, moving to accounting"
          })
        };

      default:
        throw new Error(`No agent mapped for state: ${state}`);
    }
  }

  async executeStep() {

    const state = await this.getCurrentState();

    const agent = this.selectAgent(state);

    if (!agent || typeof agent.run !== "function") {
      throw new Error("Invalid agent instance");
    }

    const decision = await agent.run();

    if (!decision) {
      throw new Error("Agent returned empty decision");
    }

    return {
      invoice_id: this.invoice_id,
      organization_id: this.organization_id,
      current_state: state,
      decision
    };
  }
}