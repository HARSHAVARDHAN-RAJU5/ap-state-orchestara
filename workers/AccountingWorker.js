import db from "../db.js";

class AccountingWorker {

  static async run(context) {

    const { invoice_id, organization_id } = context;

    // 1. Ensure accrual is posted
    await AccountingWorker.postAccrual(context);

    // 2. Fetch payment schedule
    const res = await db.query(
      `
      SELECT payment_due_date, payment_status
      FROM invoice_payment_schedule
      WHERE invoice_id = $1
      AND organization_id = $2
      `,
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

    // 3. Wait until due date (SLA loop)
    if (today < dueDate) {
      return {
        nextState: "ACCOUNTING",
        reason: "Waiting for payment due date"
      };
    }

    // 4. Execute payment
    await db.query(
      `
      UPDATE invoice_payment_schedule
      SET payment_status = 'PAID',
          paid_at = NOW()
      WHERE invoice_id = $1
      AND organization_id = $2
      `,
      [invoice_id, organization_id]
    );

    return {
      nextState: "COMPLETED",
      reason: "Payment executed"
    };
  }

  static async postAccrual(context) {

    const { invoice_id, organization_id } = context;

    const check = await db.query(
      `
      SELECT 1
      FROM journal_entries
      WHERE invoice_id = $1
      AND organization_id = $2
      LIMIT 1
      `,
      [invoice_id, organization_id]
    );

    if (check.rows.length) {
      return;
    }

    await db.query(
      `
      INSERT INTO journal_entries
      (invoice_id, organization_id, entry_type, created_at)
      VALUES ($1, $2, 'ACCRUAL', NOW())
      `,
      [invoice_id, organization_id]
    );
  }
}

export default AccountingWorker;