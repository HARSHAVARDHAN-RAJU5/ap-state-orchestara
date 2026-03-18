import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import pool from "../db.js";
import pdfjs from "pdfjs-dist/legacy/build/pdf.js";

const { getDocument } = pdfjs;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const standardFontDataUrl = path.join(
  __dirname,
  "../../../node_modules/pdfjs-dist/standard_fonts/"
);

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const LLM_RETRIES = 3;
const LLM_RETRY_DELAY_MS = 1500;

async function callLLMWithRetry(prompt) {
  for (let attempt = 1; attempt <= LLM_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `${OLLAMA_URL}/api/generate`,
        { model: "llama3", prompt, stream: false },
        { timeout: 30000 }
      );
      return response.data.response;
    } catch (err) {
      if (attempt === LLM_RETRIES) throw err;
      console.warn(`LLM attempt ${attempt} failed, retrying in ${LLM_RETRY_DELAY_MS}ms...`);
      await new Promise(r => setTimeout(r, LLM_RETRY_DELAY_MS * attempt));
    }
  }
}

function normalizeString(value) {
  if (!value) return value;
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ");
}

export async function execute(context) {

  const { invoice_id, organization_id } = context;

  if (!invoice_id || !organization_id) {
    throw new Error("ExtractionWorker requires invoice_id and organization_id");
  }

  const stateCheck = await pool.query(
    `SELECT current_state FROM invoice_state_machine
     WHERE invoice_id = $1 AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!stateCheck.rows.length) throw new Error("State record not found");
  if (stateCheck.rows[0].current_state !== "RECEIVED") {
    throw new Error("Invalid state for ExtractionWorker");
  }

  const invoiceRes = await pool.query(
    `SELECT file_path FROM invoices
     WHERE invoice_id = $1 AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, failure_type: "FILE_NOT_FOUND" };
  }

  const filePath = invoiceRes.rows[0].file_path;

  if (!fs.existsSync(filePath)) {
    return { success: false, failure_type: "FILE_MISSING_ON_DISK" };
  }

  const stats = fs.statSync(filePath);
  if (stats.size > 20 * 1024 * 1024) {
    return { success: false, failure_type: "FILE_TOO_LARGE" };
  }

  let pdfDocument;
  try {
    const buffer = fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(buffer);
    pdfDocument = await getDocument({ data: uint8Array, standardFontDataUrl }).promise;
  } catch (err) {
    return { success: false, failure_type: "CORRUPTED_PDF" };
  }

  let text = "";
  try {
    for (let i = 1; i <= pdfDocument.numPages; i++) {
      const page = await pdfDocument.getPage(i);
      const content = await page.getTextContent();
      text += "\n" + content.items.map(item => item.str).join(" ");
    }
  } catch (err) {
    return { success: false, failure_type: "PDF_TEXT_EXTRACTION_FAILED" };
  }

  if (!text || text.trim().length < 20) {
    return { success: false, failure_type: "LOW_QUALITY_PDF" };
  }

  const prompt = `
You are an AI invoice extraction engine.

Extract the following fields from the invoice text below.
Return ONLY valid JSON. No explanation, no markdown, no backticks.

Fields:
- invoice_number
- vendor_name
- gstin
- subtotal
- tax
- total_amount
- invoice_date
- due_date
- po_number
- expense_category (must be one of: SOFTWARE, OFFICE_SUPPLIES, TRAVEL, UTILITIES, GENERAL)

If numeric values contain currency symbols remove them.
If a field is missing return null.

Invoice Text:
${text}
`;

  let aiResponse;
  try {
    aiResponse = await callLLMWithRetry(prompt);
  } catch (err) {
    return { success: false, failure_type: "AI_EXTRACTION_FAILED" };
  }

  let structured;
  try {
    const clean = aiResponse.replace(/```json|```/g, "").trim();
    structured = JSON.parse(clean);
  } catch (err) {
    return { success: false, failure_type: "AI_PARSE_ERROR" };
  }

  // Sanitize numeric fields
  for (const field of ["total_amount", "subtotal", "tax"]) {
    if (structured[field] !== null && structured[field] !== undefined) {
      structured[field] = Number(String(structured[field]).replace(/[^0-9.]/g, ""));
    }
  }

  // Subtotal+tax fallback BEFORE the null guard
  if (!structured.total_amount && structured.subtotal && structured.tax) {
    structured.total_amount = structured.subtotal + structured.tax;
  }

  if (!structured.invoice_number) {
    return { success: false, failure_type: "MISSING_INVOICE_NUMBER" };
  }

  if (!structured.total_amount) {
    return { success: false, failure_type: "MISSING_TOTAL_AMOUNT" };
  }

  if (!structured.expense_category) {
    structured.expense_category = "GENERAL";
  }

  // Normalize string fields — fixes LLM inconsistency downstream
  // "Acme Corp." / "ACME CORP" / "acme corp" all become "ACME CORP"
  structured.vendor_name    = normalizeString(structured.vendor_name);
  structured.invoice_number = normalizeString(structured.invoice_number);
  structured.gstin          = structured.gstin
    ? String(structured.gstin).trim().toUpperCase()
    : structured.gstin;

  await pool.query(
    `INSERT INTO invoice_extracted_data
       (invoice_id, organization_id, data, extraction_status, extracted_at)
     VALUES ($1, $2, $3, 'SUCCESS', NOW())
     ON CONFLICT (invoice_id, organization_id)
     DO UPDATE SET
       data = EXCLUDED.data,
       extraction_status = EXCLUDED.extraction_status,
       extracted_at = NOW()`,
    [invoice_id, organization_id, structured]
  );

  return { success: true, outcome: "AI_EXTRACTION_SUCCESS" };
}