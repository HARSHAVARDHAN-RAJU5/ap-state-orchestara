import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import pool from "../../../db.js";
import redis from "../../../redisClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = ["application/pdf"];

export async function handleInvoiceIntake({
  file,
  source,
  receivedFrom,
  organization_id,
  extraMetadata = {}
}) {

  if (!file || !file.buffer) {
    throw new Error("Invalid file input");
  }

  if (!organization_id) {
    throw new Error("organization_id is required");
  }

  // Validate file type
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    throw new Error(`Invalid file type: ${file.mimetype}. Only PDF accepted.`);
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${file.size} bytes. Max 10MB.`);
  }

  const invoiceId = `inv_${randomUUID()}`;

  const invoiceDir = path.join(
    __dirname, "..", "storage", "invoices", organization_id, invoiceId
  );

  fs.mkdirSync(invoiceDir, { recursive: true });

  const originalFilePath = path.join(invoiceDir, file.originalname);
  fs.writeFileSync(originalFilePath, file.buffer);

  const receivedAt = new Date();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO invoices (
         invoice_id, organization_id, source, received_from,
         original_filename, file_path, mime_type, file_size_bytes,
         status, received_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        invoiceId, organization_id, source, receivedFrom,
        file.originalname, originalFilePath, file.mimetype,
        file.size, "RECEIVED", receivedAt
      ]
    );

    await client.query(
      `INSERT INTO invoice_state_machine
         (invoice_id, organization_id, current_state, retry_count, last_updated)
       VALUES ($1, $2, 'RECEIVED', 0, NOW())`,
      [invoiceId, organization_id]
    );

    await client.query(
      `INSERT INTO audit_event_log
         (invoice_id, organization_id, old_state, new_state, reason)
       VALUES ($1,$2,NULL,$3,$4)`,
      [invoiceId, organization_id, "RECEIVED", "Invoice received and initialized"]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    // Clean up saved file on DB failure
    try { fs.unlinkSync(originalFilePath); } catch {}
    throw err;
  } finally {
    client.release();
  }

  await redis.xAdd("invoice_events", "*", {
    invoice_id: invoiceId,
    organization_id
  });

  return {
    invoice_id: invoiceId,
    organization_id,
    status: "RECEIVED",
    received_at: receivedAt.toISOString()
  };
}

export default handleInvoiceIntake;