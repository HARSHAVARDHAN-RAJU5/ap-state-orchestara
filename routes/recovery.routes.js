import express from "express";
import multer from "multer";
import pool from "../db.js";
import redis from "../redisClient.js";

const router = express.Router();

const upload = multer({
  dest: "recovery_uploads/",
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

router.post("/upload", upload.single("file"), async (req, res) => {

  const { token } = req.query;
  const file = req.file;

  if (!token || !file) {
    return res.status(400).json({ error: "Missing token or file" });
  }

  // Validate MIME type
  if (file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "Only PDF files accepted" });
  }

  // Fetch invoice + org_id FIRST — before any mutations
  const stateRes = await pool.query(
    `SELECT invoice_id, organization_id, token_expiry
     FROM invoice_state_machine
     WHERE verification_token = $1`,
    [token]
  );

  if (!stateRes.rows.length) {
    return res.status(400).json({ error: "Invalid token" });
  }

  const { invoice_id, organization_id, token_expiry } = stateRes.rows[0];

  if (new Date() > token_expiry) {
    return res.status(400).json({ error: "Token expired" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Replace invoice file path
    await client.query(
      `UPDATE invoices SET file_path = $1 WHERE invoice_id = $2`,
      [file.path, invoice_id]
    );

    // Clear stale extracted data so fresh extraction runs
    await client.query(
      `DELETE FROM invoice_extracted_data
       WHERE invoice_id = $1 AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    // Reset state — org_id already known, no second query needed
    await client.query(
      `UPDATE invoice_state_machine
       SET verification_token = NULL,
           token_expiry = NULL,
           waiting_since = NULL,
           waiting_deadline = NULL,
           waiting_reason = NULL,
           current_state = 'RECEIVED',
           retry_count = 0,
           last_updated = NOW()
       WHERE invoice_id = $1 AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Recovery upload error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }

  // Re-emit event — org_id guaranteed to be correct
  await redis.xAdd("invoice_events", "*", { invoice_id, organization_id });

  return res.json({ message: "File received. Processing resumed." });
});

export default router;