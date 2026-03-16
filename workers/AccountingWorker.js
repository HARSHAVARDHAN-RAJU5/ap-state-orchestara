import db from "../db.js";

class AccountingWorker {

  static async run(context) {

    const { invoice_id, organization_id } = context;

    // 1. Ensure accrual is posted
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

    // 4. Execute payment
    await db.query(
      `UPDATE invoice_payment_schedule
       SET payment_status = 'PAID',
           paid_at = NOW()
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    return {
      nextState: "COMPLETED",
      reason: "Payment executed"
    };
  }

  static async postAccrual(context) {

    const { invoice_id, organization_id } = context;

    // check if already posted
    const check = await db.query(
      `SELECT journal_id FROM journal_entries
       WHERE invoice_id = $1
       AND organization_id = $2
       LIMIT 1`,
      [invoice_id, organization_id]
    );

    if (check.rows.length) {
      return;
    }

    // get invoice amount and category
    const invoiceRes = await db.query(
      `SELECT data FROM invoice_extracted_data
       WHERE invoice_id = $1
       AND organization_id = $2`,
      [invoice_id, organization_id]
    );

    const invoice = invoiceRes.rows[0]?.data || {};
    const amount = parseFloat(invoice.total_amount || 0);
    const category = invoice.expense_category || "GENERAL";

    // get account mapping
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

    // insert journal entry
    const entryRes = await db.query(
      `INSERT INTO journal_entries
       (invoice_id, organization_id, entry_type, status, created_at)
       VALUES ($1, $2, 'ACCRUAL', 'POSTED', NOW())
       RETURNING journal_id`,
      [invoice_id, organization_id]
    );

    const journal_id = entryRes.rows[0].journal_id;

    // Dr Expense
    await db.query(
      `INSERT INTO journal_lines
       (journal_id, account_id, debit_amount, credit_amount)
       VALUES ($1, $2, $3, $4)`,
      [journal_id, expense_account_id, amount, 0]
    );

    // Cr Accounts Payable
    await db.query(
      `INSERT INTO journal_lines
       (journal_id, account_id, debit_amount, credit_amount)
       VALUES ($1, $2, $3, $4)`,
      [journal_id, ap_account_id, 0, amount]
    );
  }
}

export default AccountingWorker;