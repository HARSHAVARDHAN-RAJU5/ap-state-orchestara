import BaseAgent from "./BaseAgent.js";
import * as Worker from "../workers/MatchingWorker.js";
<<<<<<< HEAD
=======
import axios from "axios";
import db from "../db.js";

function safeParseLLM(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("Invalid LLM JSON:", raw);
    return null;
  }
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}
>>>>>>> 334e7eaa60325a69e2de3c1bc1fe5a7582d0439e

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

<<<<<<< HEAD
    if (!result?.success) {
=======
    const { invoice_id, organization_id } = this.context;

    if (!observation?.success) {
>>>>>>> 334e7eaa60325a69e2de3c1bc1fe5a7582d0439e
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

<<<<<<< HEAD
    if (bank_mismatch_flag) {
=======
Signals:
${JSON.stringify(observation.signals)}

Respond ONLY with valid JSON.

{
  "classification": "VALID" | "REVIEW" | "WAITING_INFO" | "BLOCKED",
  "reason": "short explanation",
  "risk_score": number
}
`;

    let response;

    try {

      response = await axios.post(
        "http://127.0.0.1:11434/api/generate",
        {
          model: "llama3",
          prompt,
          stream: false
        }
      );

    } catch (err) {

      console.error("LLM call failed:", err.message);

>>>>>>> 334e7eaa60325a69e2de3c1bc1fe5a7582d0439e
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

<<<<<<< HEAD
    return {
      nextState: "COMPLIANCE",
      reason: "PO matching successful"
    };
=======
    const output = safeParseLLM(jsonBlock);

    if (!output || !output.classification) {
      return {
        nextState: "BLOCKED",
        reason: "Malformed LLM JSON"
      };
    }

    const riskScore = output.risk_score ?? null;
    const classification = output.classification;
    const reason = output.reason ?? null;

    // -----------------------
    // STORE RISK RESULT
    // -----------------------

    await db.query(
      `
      INSERT INTO invoice_risk_assessment
      (
        invoice_id,
        organization_id,
        risk_score,
        classification,
        reason,
        evaluated_at
      )
      VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (invoice_id, organization_id)
      DO UPDATE SET
        risk_score = EXCLUDED.risk_score,
        classification = EXCLUDED.classification,
        reason = EXCLUDED.reason,
        evaluated_at = NOW()
      `,
      [
        invoice_id,
        organization_id,
        riskScore,
        classification,
        reason
      ]
    );

    // -----------------------
    // STATE TRANSITION
    // -----------------------

    switch (classification) {

      case "BLOCKED":
        return {
          nextState: "BLOCKED",
          reason
        };

      case "WAITING_INFO":
        return {
          nextState: "WAITING_INFO",
          reason
        };

      case "REVIEW":
        return {
          nextState: "EXCEPTION_REVIEW",
          reason
        };

      case "VALID":
        return {
          nextState: "PENDING_APPROVAL",
          reason
        };

      default:
        return {
          nextState: "BLOCKED",
          reason: "Unknown LLM classification"
        };
    }
>>>>>>> 334e7eaa60325a69e2de3c1bc1fe5a7582d0439e
  }
}