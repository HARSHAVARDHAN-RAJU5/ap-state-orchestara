import db from "../db.js";
import { isAlreadyDone, markDone } from "../core/workerIdempotency.js";

const BANK_ACCOUNT_ID = process.env.BANK_ACCOUNT_ID || 3001;

class AccountingWorker {

  static async run(context) {

    const { invoice_id, organization_id } = context;

    // Idempotency — if the full ACCOUNTING step already completed, skip
    if (await isAlreadyDone(invoice_id, organization_id, "ACCOUNTING")) return { nextState: "COMPLETED", reason: "Invoice already processed" };

    // 1. Ensure accrual is posted (has its own internal idempotency check)
    await AccountingWorker.postAccrual(context);

    // 2. Fetch payment schedule
    const res = await db.query(
      `SELECT payment_due_date, payment_status
       FROM invoice_payment_schedule
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    if (!res.rows.length) {
      throw new Error("Payment schedule missing");
    }

    const { payment_due_date, payment_status } = res.rows[0];

    if (payment_status === "PAID") {
      return { nextState: "COMPLETED", reason: "Invoice already paid" };
    }

    const today = new Date();
    const dueDate = new Date(payment_due_date);

    if (today < dueDate) {
      return { nextState: "ACCOUNTING", reason: "Waiting for payment due date" };
    }

    // 3. Execute payment + clearance journal + markDone — all atomic
    // markDone is inside this transaction so a crash before COMMIT means
    // the record is NOT written → retry will re-run safely
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE invoice_payment_schedule
         SET payment_status = 'PAID', paid_at = NOW()
         WHERE invoice_id = $1 AND organization_id = $2`,
        [invoice_id, organization_id]
      );

      // Post clearance journal: Dr AP / Cr Bank
      await AccountingWorker.postClearanceJournal(client, context);

      // Populate paid_invoice_registry
      const invoiceRes = await client.query(
        `SELECT data FROM invoice_extracted_data
         WHERE invoice_id = $1 AND organization_id = $2`,
        [invoice_id, organization_id]
      );
      const invoice = invoiceRes.rows[0]?.data || {};

      await client.query(
        `INSERT INTO paid_invoice_registry
           (invoice_id, organization_id, invoice_number, vendor_name, total_amount, paid_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (organization_id, invoice_number, vendor_name) DO NOTHING`,
        [
          invoice_id,
          organization_id,
          invoice.invoice_number || null,
          invoice.vendor_name || null,
          parseFloat(invoice.total_amount || 0)
        ]
      );

      // markDone inside the same transaction — atomically tied to the work above
      await markDone(invoice_id, organization_id, "ACCOUNTING", client);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return { nextState: "COMPLETED", reason: "Payment executed" };
  }

  static async postAccrual(context) {

    const { invoice_id, organization_id } = context;

    // Internal idempotency — accrual has its own check separate from
    // the main ACCOUNTING completion check because it can be posted
    // before the payment clears
    const check = await db.query(
      `SELECT journal_id FROM journal_entries
       WHERE invoice_id = $1 AND organization_id = $2
       AND entry_type = 'ACCRUAL'
       LIMIT 1`,
      [invoice_id, organization_id]
    );

    if (check.rows.length) return;

    const invoiceRes = await db.query(
      `SELECT data FROM invoice_extracted_data
       WHERE invoice_id = $1 AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    const invoice = invoiceRes.rows[0]?.data || {};
    const amount = parseFloat(invoice.total_amount || 0);
    const category = invoice.expense_category || "GENERAL";

    let mappingRes = await db.query(
      `SELECT expense_account_id, ap_account_id
       FROM account_mapping
       WHERE organization_id = $1 AND expense_category = $2`,
      [organization_id, category]
    );

    // GENERAL fallback before throwing
    if (!mappingRes.rows.length) {
      mappingRes = await db.query(
        `SELECT expense_account_id, ap_account_id
         FROM account_mapping
         WHERE organization_id = $1 AND expense_category = 'GENERAL'`,
        [organization_id]
      );

      if (!mappingRes.rows.length) {
        throw new Error(`No account mapping for category: ${category} and no GENERAL fallback`);
      }
    }

    const { expense_account_id, ap_account_id } = mappingRes.rows[0];

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const entryRes = await client.query(
        `INSERT INTO journal_entries
           (invoice_id, organization_id, entry_type, status, created_at)
         VALUES ($1, $2, 'ACCRUAL', 'POSTED', NOW())
         RETURNING journal_id`,
        [invoice_id, organization_id]
      );

      const journal_id = entryRes.rows[0].journal_id;

      // Dr Expense
      await client.query(
        `INSERT INTO journal_lines (journal_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, $3, 0)`,
        [journal_id, expense_account_id, amount]
      );

      // Cr Accounts Payable
      await client.query(
        `INSERT INTO journal_lines (journal_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, 0, $3)`,
        [journal_id, ap_account_id, amount]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async postClearanceJournal(client, context) {

    const { invoice_id, organization_id } = context;

    const check = await client.query(
      `SELECT journal_id FROM journal_entries
       WHERE invoice_id = $1 AND organization_id = $2
       AND entry_type = 'CLEARANCE'
       LIMIT 1`,
      [invoice_id, organization_id]
    );

    if (check.rows.length) return;

    const invoiceRes = await client.query(
      `SELECT data FROM invoice_extracted_data
       WHERE invoice_id = $1 AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    const invoice = invoiceRes.rows[0]?.data || {};
    const amount = parseFloat(invoice.total_amount || 0);
    const category = invoice.expense_category || "GENERAL";

    let mappingRes = await client.query(
      `SELECT ap_account_id FROM account_mapping
       WHERE organization_id = $1 AND expense_category = $2`,
      [organization_id, category]
    );

    if (!mappingRes.rows.length) {
      mappingRes = await client.query(
        `SELECT ap_account_id FROM account_mapping
         WHERE organization_id = $1 AND expense_category = 'GENERAL'`,
        [organization_id]
      );
    }

    if (!mappingRes.rows.length) return;

    const { ap_account_id } = mappingRes.rows[0];

    const entryRes = await client.query(
      `INSERT INTO journal_entries
         (invoice_id, organization_id, entry_type, status, created_at)
       VALUES ($1, $2, 'CLEARANCE', 'POSTED', NOW())
       RETURNING journal_id`,
      [invoice_id, organization_id]
    );

    const journal_id = entryRes.rows[0].journal_id;

    // Dr Accounts Payable
    await client.query(
      `INSERT INTO journal_lines (journal_id, account_id, debit_amount, credit_amount)
       VALUES ($1, $2, $3, 0)`,
      [journal_id, ap_account_id, amount]
    );

    // Cr Bank
    await client.query(
      `INSERT INTO journal_lines (journal_id, account_id, debit_amount, credit_amount)
       VALUES ($1, $2, 0, $3)`,
      [journal_id, BANK_ACCOUNT_ID, amount]
    );
  }
}

export default AccountingWorker;
