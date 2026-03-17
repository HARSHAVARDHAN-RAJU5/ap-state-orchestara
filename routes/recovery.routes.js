import express from "express";
import multer from "multer";
import pool from "../db.js";
import { createClient } from "redis";

const router = express.Router();
const upload = multer({ dest: "recovery_uploads/" });

const redis = createClient({
  url: "redis://127.0.0.1:6379"
});

await redis.connect();

router.post("/upload", upload.single("file"), async (req, res) => {

  const { token } = req.query;
  const file = req.file;

  if (!token || !file) {
    return res.status(400).json({ error: "Missing token or file" });
  }

  const stateRes = await pool.query(
    `SELECT invoice_id, token_expiry
     FROM invoice_state_machine
     WHERE verification_token = $1`,
    [token]
  );

  if (!stateRes.rows.length) {
    return res.status(400).json({ error: "Invalid token" });
  }

  const { invoice_id, token_expiry } = stateRes.rows[0];

  if (new Date() > token_expiry) {
    return res.status(400).json({ error: "Token expired" });
  }

  // Replace invoice file path
  await pool.query(
    `UPDATE invoices
     SET file_path = $1
     WHERE invoice_id = $2`,
    [file.path, invoice_id]
  );

  // Clear WAITING_INFO metadata
  await pool.query(
    `UPDATE invoice_state_machine
     SET verification_token = NULL,
         token_expiry = NULL,
         current_state = 'RECEIVED',
         last_updated = NOW()
     WHERE invoice_id = $1`,
    [invoice_id]
  );

const orgRes = await pool.query(
    `SELECT organization_id FROM invoice_state_machine WHERE invoice_id = $1`,
    [invoice_id]
);
const organization_id = orgRes.rows[0]?.organization_id;

  await pool.query(
    `DELETE FROM invoice_extracted_data 
    WHERE invoice_id = $1 AND organization_id = $2`,
    [invoice_id, organization_id]
  );

  // 🔁 Re-emit event


  await redis.xAdd(
      "invoice_events",
      "*",
      { invoice_id, organization_id }
  );

  return res.json({
    message: "File received. Processing resumed."
  });
});

export default router;
