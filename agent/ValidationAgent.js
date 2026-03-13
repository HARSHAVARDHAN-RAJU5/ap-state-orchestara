import BaseAgent from "./BaseAgent.js";
import { execute as ValidationWorker } from "../workers/ValidationWorker.js";
import pool from "../db.js";
import axios from "axios";

export default class ValidationAgent extends BaseAgent {

  constructor(context) {
    super(context);
  }

  async plan() {
    return { action: "RUN_VENDOR_VALIDATION" };
  }

  async act() {
    return await ValidationWorker(this.context);
  }

  async evaluate(result) {

    if (!result) {
      return {
        nextState: "BLOCKED",
        reason: "Validation worker returned no result"
      };
    }

    if (result.success === false) {
      return {
        nextState: "BLOCKED",
        reason: result.reason || "Validation failed"
      };
    }

    if (result.status === "EXCEPTION_REVIEW") {
      return {
        nextState: "EXCEPTION_REVIEW",
        reason: result.reason
      };
    }

    if (result.status === "BLOCKED") {
      return {
        nextState: "BLOCKED",
        reason: result.reason || "Validation rule blocked invoice"
      };
    }

    if (result.status === "VALID") {
      return {
        nextState: "MATCHING",
        reason: "Validation successful"
      };
    }

    if (result.status === "REVIEW_REQUIRED") {

      const context = await this.buildRiskContext(result.reason);
      const llmDecision = await this.callLLM(context);

      if (llmDecision === "PROCEED") {
        return {
          nextState: "MATCHING",
          reason: "LLM approved invoice after review"
        };
      }

      if (llmDecision === "WAIT") {
        return {
          nextState: "WAITING_INFO",
          reason: "Additional vendor or invoice information required"
        };
      }

      return {
        nextState: "BLOCKED",
        reason: "LLM flagged invoice as high risk"
      };
    }

    return {
      nextState: "BLOCKED",
      reason: "Unhandled validation state"
    };
  }

  async buildRiskContext(reviewReason) {

    const extracted = await pool.query(
      `
      SELECT data
      FROM invoice_extracted_data
      WHERE invoice_id = $1
      AND organization_id = $2
      `,
      [this.invoice_id, this.organization_id]
    );

    const validation = await pool.query(
      `
      SELECT *
      FROM invoice_validation_results
      WHERE invoice_id = $1
      AND organization_id = $2
      `,
      [this.invoice_id, this.organization_id]
    );

    return {
      review_reason: reviewReason,
      extracted_data: extracted.rows[0]?.data || {},
      validation_result: validation.rows[0] || {}
    };
  }

  async callLLM(context) {

    const prompt = `
You are an accounts payable risk analyst.

An invoice failed automated validation and requires review.

Review Reason:
${context.review_reason}

Invoice Data:
${JSON.stringify(context.extracted_data, null, 2)}

Validation Record:
${JSON.stringify(context.validation_result, null, 2)}

Decide the safest next step for the AP system:

PROCEED  -> invoice appears safe, continue processing
WAIT     -> request additional information from vendor
BLOCK    -> invoice appears suspicious or high risk

Respond with ONLY one word:
PROCEED
WAIT
BLOCK
`;

    try {
      const response = await axios.post(
        "http://127.0.0.1:11434/api/generate",
        {
          model: "llama3",
          prompt,
          stream: false
        }
      );

      const output = response.data?.response?.trim()?.toUpperCase();

      if (!output) return "BLOCK";

      if (output.includes("PROCEED")) return "PROCEED";
      if (output.includes("WAIT")) return "WAIT";

      return "BLOCK";

    } catch {
      return "BLOCK";
    }
  }
}