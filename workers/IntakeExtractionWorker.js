import fs from "fs";
import axios from "axios";
import pool from "../db.js";
import pdfjs from "pdfjs-dist/legacy/build/pdf.js";

const { getDocument } = pdfjs;

export async function execute(context) {

  const { invoice_id, organization_id } = context;

  if (!invoice_id || !organization_id) {
    throw new Error("ExtractionWorker requires invoice_id and organization_id");
  }

  // Verify state
  const stateCheck = await pool.query(
    `
    SELECT current_state
    FROM invoice_state_machine
    WHERE invoice_id = $1
      AND organization_id = $2
    `,
    [invoice_id, organization_id]
  );

  if (!stateCheck.rows.length) {
    throw new Error("State record not found");
  }

  if (stateCheck.rows[0].current_state !== "RECEIVED") {
    throw new Error("Invalid state for ExtractionWorker");
  }

  // Get invoice file path
  const invoiceRes = await pool.query(
    `
    SELECT file_path
    FROM invoices
    WHERE invoice_id = $1
      AND organization_id = $2
    `,
    [invoice_id, organization_id]
  );

  if (!invoiceRes.rows.length) {
    return { success: false, failure_type: "FILE_NOT_FOUND" };
  }

  const filePath = invoiceRes.rows[0].file_path;

  if (!fs.existsSync(filePath)) {
    return { success: false, failure_type: "FILE_MISSING_ON_DISK" };
  }

  // Read PDF
  let pdfDocument;

  try {
    const buffer = fs.readFileSync(filePath);
    const uint8Array = new Uint8Array(buffer);

    const loadingTask = getDocument({ data: uint8Array });
    pdfDocument = await loadingTask.promise;

  } catch (err) {
    return { success: false, failure_type: "CORRUPTED_PDF" };
  }

  // Extract text from all pages
  let text = "";

  try {

    for (let i = 1; i <= pdfDocument.numPages; i++) {
      const page = await pdfDocument.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(" ");
      text += "\n" + pageText;
    }

  } catch (err) {
    return { success: false, failure_type: "PDF_TEXT_EXTRACTION_FAILED" };
  }

  if (!text || text.trim().length < 20) {
    return { success: false, failure_type: "LOW_QUALITY_PDF" };
  }

  // LLM prompt
  const prompt = `
You are an AI invoice extraction engine.

Extract the following fields from the invoice text below.
Return ONLY valid JSON. No explanation.

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

If numeric values contain currency symbols remove them.
If a field is missing return null.

Invoice Text:
${text}
`;

  let aiResponse;

  try {

    const response = await axios.post(
      "http://127.0.0.1:11434/api/generate",
      {
        model: "llama3",
        prompt,
        stream: false
      }
    );

    aiResponse = response.data.response;

  } catch (err) {
    return { success: false, failure_type: "AI_EXTRACTION_FAILED" };
  }

  let structured;

  try {
    structured = JSON.parse(aiResponse);
  } catch (err) {
    return { success: false, failure_type: "AI_PARSE_ERROR" };
  }

  // Normalize numeric values
  if (structured.total_amount !== null && structured.total_amount !== undefined) {
    structured.total_amount = Number(
      String(structured.total_amount).replace(/[^0-9.]/g, "")
    );
  }

  if (structured.subtotal !== null && structured.subtotal !== undefined) {
    structured.subtotal = Number(
      String(structured.subtotal).replace(/[^0-9.]/g, "")
    );
  }

  if (structured.tax !== null && structured.tax !== undefined) {
    structured.tax = Number(
      String(structured.tax).replace(/[^0-9.]/g, "")
    );
  }

  // If critical fields missing → WAITING_INFO
  if (!structured.invoice_number) {
    return { success: false, failure_type: "MISSING_INVOICE_NUMBER" };
  }

  if (!structured.total_amount) {
    return { success: false, failure_type: "MISSING_TOTAL_AMOUNT" };
  }

  // Do NOT assume tax rate
  // Only derive if subtotal + tax present but total missing
  if (!structured.total_amount && structured.subtotal && structured.tax) {
    structured.total_amount = structured.subtotal + structured.tax;
  }

  // Save structured result
  await pool.query(
    `
    INSERT INTO invoice_extracted_data
      (invoice_id, organization_id, data, extraction_status, extracted_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (invoice_id, organization_id)
    DO UPDATE SET
      data = EXCLUDED.data,
      extraction_status = EXCLUDED.extraction_status,
      extracted_at = NOW()
    `,
    [
      invoice_id,
      organization_id,
      structured,
      "SUCCESS"
    ]
  );

  return {
    success: true,
    outcome: "AI_EXTRACTION_SUCCESS"
  };

}