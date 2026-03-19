import pool from "../db.js";

// Returns true if this worker has already successfully completed
// for this invoice + state combination.
// Silent return — no logging. Logging on failure only.
export async function isAlreadyDone(invoice_id, organization_id, state) {
  const res = await pool.query(
    `SELECT 1 FROM worker_completion_log
     WHERE invoice_id = $1
       AND organization_id = $2
       AND state = $3
     LIMIT 1`,
    [invoice_id, organization_id, state]
  );
  return res.rows.length > 0;
}

// Records that this worker completed successfully.
// Must be called inside the same DB transaction as the worker's main write
// for AccountingWorker. For other workers a separate call is fine.
export async function markDone(invoice_id, organization_id, state, client = pool) {
  await client.query(
    `INSERT INTO worker_completion_log
       (invoice_id, organization_id, state, completed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (invoice_id, organization_id, state) DO NOTHING`,
    [invoice_id, organization_id, state]
  );
}
