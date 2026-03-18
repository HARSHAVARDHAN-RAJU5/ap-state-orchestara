import pool from "../db.js";

export async function isAlreadyDone(invoice_id, organization_id, state) {
  const res = await pool.query(
    `SELECT 1 FROM worker_completion_log
     WHERE invoice_id = $1
       AND organization_id = $2
       AND state = $3`,
    [invoice_id, organization_id, state]
  );
  return res.rows.length > 0;
}

export async function markDone(invoice_id, organization_id, state) {
  await pool.query(
    `INSERT INTO worker_completion_log
       (invoice_id, organization_id, state, completed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (invoice_id, organization_id, state) DO NOTHING`,
    [invoice_id, organization_id, state]
  );
}