import db from "../db.js";

class AccountingWorker {

  static async run(context) {

    const { invoice_id, organization_id } = context;

    // 1. Ensure accrual is posted (idempotent — checks before inserting)
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

    // If already paid
    if (payment_status === "PAID") {
      return {
        nextState: "COMPLETED",
        reason: "Invoice already paid"
      };
    }

    const today = new Date();
    const dueDate = new Date(payment_due_date);

    // 3. Wait until due date
    if (today < dueDate) {
      return {
        nextState: "ACCOUNTING",
        reason: "Waiting for payment due date"
      };
    }

    // 4. Execute payment + post clearance entry — both in one transaction
    // FIX T1-2 (partial) + FIX T2-4: Marking PAID and posting the clearance
    // journal entry (Dr AP / Cr Bank) in the same atomic transaction.
    // Previously: payment was marked PAID with no clearance journal at all.
    await AccountingWorker.executePaymentAndPostClearance(context);

    return {
      nextState: "COMPLETED",
      reason: "Payment executed and clearance journal posted"
    };
  }

  static async postAccrual(context) {

    const { invoice_id, organization_id } = context;

    // FIX T1-2: Check specifically for an ACCRUAL entry, not just any entry.
    // Previously the check was entry-type-agnostic — a future PAYMENT_CLEARANCE
    // entry would have blocked this and silently skipped the accrual.
    const check = await db.query(
      `SELECT journal_id FROM journal_entries
       WHERE invoice_id = $1
       AND organization_id = $2
       AND entry_type = 'ACCRUAL'
       LIMIT 1`,
      [invoice_id, organization_id]
    );

    if (check.rows.length) {
      return; // Accrual already posted — idempotent, skip
    }

    // Get invoice amount and category
    const invoiceRes = await db.query(
      `SELECT data FROM invoice_extracted_data
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    const invoice = invoiceRes.rows[0]?.data || {};
    const amount = parseFloat(invoice.total_amount || 0);
    const category = invoice.expense_category || "GENERAL";

    // Get account mapping
    const mappingRes = await db.query(
      `SELECT expense_account_id, ap_account_id
       FROM account_mapping
       WHERE organization_id = $1
       AND expense_category = $2`,
      [organization_id, category]
    );

    if (!mappingRes.rows.length) {
      throw new Error(`No account mapping found for category: ${category}`);
    }

    const { expense_account_id, ap_account_id } = mappingRes.rows[0];

    // FIX T1-2: Wrap all three inserts in a single transaction.
    // Previously the header and two lines were 3 separate queries.
    // A crash between any two would leave an orphaned journal_entries row
    // that permanently blocks future accrual attempts.
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
        `INSERT INTO journal_lines
         (journal_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, $3, $4)`,
        [journal_id, expense_account_id, amount, 0]
      );

      // Cr Accounts Payable
      await client.query(
        `INSERT INTO journal_lines
         (journal_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, $3, $4)`,
        [journal_id, ap_account_id, 0, amount]
      );

      await client.query("COMMIT");

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async executePaymentAndPostClearance(context) {

    const { invoice_id, organization_id } = context;

    // Get invoice data for clearance entry
    const invoiceRes = await db.query(
      `SELECT data FROM invoice_extracted_data
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    const invoice = invoiceRes.rows[0]?.data || {};
    const amount = parseFloat(invoice.total_amount || 0);
    const category = invoice.expense_category || "GENERAL";

    const mappingRes = await db.query(
      `SELECT ap_account_id
       FROM account_mapping
       WHERE organization_id = $1
       AND expense_category = $2`,
      [organization_id, category]
    );

    if (!mappingRes.rows.length) {
      throw new Error(`No account mapping for clearance: ${category}`);
    }

    const { ap_account_id } = mappingRes.rows[0];

    // FIX T2-4: Post payment clearance journal (Dr AP / Cr Bank) and mark
    // payment PAID in one atomic transaction.
    // Previously: payment was marked PAID but the clearance entry was never
    // posted, leaving Accounts Payable permanently open on the books.
    //
    // FIX T2-3: Also populate paid_invoice_registry so future duplicate
    // checks can detect already-paid invoices. Previously this table was
    // never written to, making the duplicate check permanently blind.
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      // Mark payment as PAID
      await client.query(
        `UPDATE invoice_payment_schedule
         SET payment_status = 'PAID',
             paid_at = NOW()
         WHERE invoice_id = $1
         AND organization_id = $2`,
        [invoice_id, organization_id]
      );

      // Post clearance journal entry: Dr AP (debit the liability) / Cr Bank (credit the asset)
      const clearanceRes = await client.query(
        `INSERT INTO journal_entries
         (invoice_id, organization_id, entry_type, status, created_at)
         VALUES ($1, $2, 'PAYMENT_CLEARANCE', 'POSTED', NOW())
         RETURNING journal_id`,
        [invoice_id, organization_id]
      );

      const clearance_journal_id = clearanceRes.rows[0].journal_id;

      // Dr Accounts Payable (clears the liability)
      await client.query(
        `INSERT INTO journal_lines
         (journal_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, $3, $4)`,
        [clearance_journal_id, ap_account_id, amount, 0]
      );

      // Cr Bank (cash goes out)
      // Using account 3001 as the bank/cash account.
      // This should be configurable per org in a future iteration.
      const BANK_ACCOUNT_ID = 3001;
      await client.query(
        `INSERT INTO journal_lines
         (journal_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, $3, $4)`,
        [clearance_journal_id, BANK_ACCOUNT_ID, 0, amount]
      );

      // Populate paid_invoice_registry to protect future duplicate checks
      await client.query(
        `INSERT INTO paid_invoice_registry
          (organization_id, invoice_id, invoice_number, vendor_name, total_amount, paid_at)
         SELECT $1, $2,
           data->>'invoice_number',
           data->>'vendor_name',
           (data->>'total_amount')::numeric,
           NOW()
         FROM invoice_extracted_data
         WHERE invoice_id = $2
         AND organization_id = $1
         ON CONFLICT DO NOTHING`,
        [organization_id, invoice_id]
      );

      await client.query("COMMIT");

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

export default AccountingWorker;