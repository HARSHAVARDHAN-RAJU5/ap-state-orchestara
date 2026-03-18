import pool from "../db.js";
import crypto from "crypto";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const APP_URL    = process.env.APP_URL    || "https://yourdomain.com";

async function generateEmailBody(invoiceId, issueContext, recoveryLink) {

  const prompt = `
You are an Accounts Payable communication assistant.

Write a professional email to a vendor regarding their invoice.

Invoice ID: ${invoiceId}

Issue Summary:
${issueContext}

Recovery Link:
${recoveryLink}

Instructions:
- Professional tone
- Clear action required
- Mention a 10-day deadline
- Keep concise
- Do not expose internal system details
- Return only the email body text
`;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3",
      prompt,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error("LLM email generation failed");
  }

  const data = await response.json();

  if (!data.response) {
    throw new Error("Invalid LLM response");
  }

  return data.response.trim();
}

export async function execute(context) {

  const { invoice_id, organization_id } = context;
  const reason = context.reason || "Additional information required";

  if (!invoice_id || !organization_id) {
    throw new Error("NotificationWorker requires invoice_id and organization_id");
  }

  const token = crypto.randomBytes(32).toString("hex");

  const recoveryLink = `${APP_URL}/${organization_id}/api/recovery/upload?token=${token}`;

  await pool.query(
    `UPDATE invoice_state_machine
     SET waiting_since      = NOW(),
         waiting_deadline   = NOW() + INTERVAL '10 days',
         verification_token = $1,
         token_expiry       = NOW() + INTERVAL '10 days',
         waiting_reason     = $2,
         last_updated       = NOW()
     WHERE invoice_id = $3 AND organization_id = $4`,
    [token, reason, invoice_id, organization_id]
  );

  let issueContext = reason;

  try {

    const validationRes = await pool.query(
      `SELECT legal_status, bank_status, tax_status
       FROM invoice_validation_results
       WHERE invoice_id = $1 AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    if (validationRes.rows.length) {
      const v = validationRes.rows[0];
      issueContext = `
Reason: ${reason}

Vendor Validation Summary:
- Legal Status: ${v.legal_status}
- Tax Status: ${v.tax_status}
- Bank Status: ${v.bank_status}
`;
    }

  } catch (err) {
    console.error("Validation context fetch failed:", err.message);
  }

  let emailBody;

  try {
    emailBody = await generateEmailBody(invoice_id, issueContext, recoveryLink);
  } catch (err) {

    console.error("LLM failed. Using fallback template.");

    emailBody = `
Dear Vendor,

We require clarification regarding invoice ${invoice_id}.

Issue:
${reason}

Please provide the necessary correction using the secure link below within 10 days:
${recoveryLink}

If no response is received within 10 days, the invoice will be automatically blocked.

Regards,
Accounts Payable Team
`;
  }

  console.log("Sending vendor notification for invoice:", invoice_id);
  console.log(emailBody);

  return { success: true };
}