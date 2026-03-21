from db import get_connection
from datetime import datetime
import os

def run(state: dict) -> dict:
    invoice_id = state["invoice_id"]
    organization_id = state["organization_id"]

    # get extracted invoice data
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT data FROM invoice_extracted_data WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return {**state, "next_state": None, "reason": "Extracted data not found"}

    invoice = row[0]
    amount = float(invoice.get("total_amount") or 0)
    category = invoice.get("expense_category") or "GENERAL"

    # check if journal entry already exists — idempotency
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT journal_id FROM journal_entries WHERE invoice_id = %s AND organization_id = %s LIMIT 1",
        (invoice_id, organization_id)
    )
    existing = cur.fetchone()
    cur.close()
    conn.close()

    if not existing:

        # get account mapping
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT expense_account_id, ap_account_id
            FROM account_mapping
            WHERE organization_id = %s
            AND expense_category = %s
            """,
            (organization_id, category)
        )
        mapping = cur.fetchone()
        cur.close()
        conn.close()

        if not mapping:
            # fallback to GENERAL
            conn = get_connection()
            cur = conn.cursor()
            cur.execute(
                """
                SELECT expense_account_id, ap_account_id
                FROM account_mapping
                WHERE organization_id = %s
                AND expense_category = 'GENERAL'
                """,
                (organization_id,)
            )
            mapping = cur.fetchone()
            cur.close()
            conn.close()

        if not mapping:
            return {**state, "next_state": "EXCEPTION_REVIEW", "reason": "No account mapping found"}

        expense_account_id, ap_account_id = mapping

        # write journal entry + lines atomically
        conn = get_connection()
        cur = conn.cursor()

        try:
            # insert journal entry
            cur.execute(
                """
                INSERT INTO journal_entries
                    (invoice_id, organization_id, entry_type, status, created_at)
                VALUES (%s, %s, 'ACCRUAL', 'POSTED', NOW())
                RETURNING journal_id
                """,
                (invoice_id, organization_id)
            )
            journal_id = cur.fetchone()[0]

            # dr expense account
            cur.execute(
                """
                INSERT INTO journal_lines
                    (journal_id, account_id, debit_amount, credit_amount)
                VALUES (%s, %s, %s, %s)
                """,
                (journal_id, expense_account_id, amount, 0)
            )

            # cr accounts payable
            cur.execute(
                """
                INSERT INTO journal_lines
                    (journal_id, account_id, debit_amount, credit_amount)
                VALUES (%s, %s, %s, %s)
                """,
                (journal_id, ap_account_id, 0, amount)
            )

            conn.commit()

        except Exception as e:
            conn.rollback()
            cur.close()
            conn.close()
            return {**state, "next_state": "EXCEPTION_REVIEW", "reason": f"Journal entry failed: {str(e)}"}

        cur.close()
        conn.close()

    # check payment schedule
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT payment_due_date, payment_status
        FROM invoice_payment_schedule
        WHERE invoice_id = %s AND organization_id = %s
        """,
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": "Payment schedule missing"}

    payment_due_date, payment_status = row

    if payment_status == "PAID":
        return {**state, "next_state": "COMPLETED", "reason": "Invoice already paid"}

    today = datetime.now().date()
    due_date = payment_due_date.date() if hasattr(payment_due_date, "date") else payment_due_date

    # not due yet — stay in ACCOUNTING
    if today < due_date:
        return {**state, "next_state": "ACCOUNTING", "reason": f"Waiting for payment due date: {due_date}"}

    # execute payment
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE invoice_payment_schedule
        SET payment_status = 'PAID', paid_at = NOW()
        WHERE invoice_id = %s AND organization_id = %s
        """,
        (invoice_id, organization_id)
    )

    # write payment clearance journal — Dr AP / Cr Bank
    cur.execute(
        """
        INSERT INTO journal_entries
            (invoice_id, organization_id, entry_type, status, created_at)
        VALUES (%s, %s, 'PAYMENT', 'POSTED', NOW())
        RETURNING journal_id
        """,
        (invoice_id, organization_id)
    )
    journal_id = cur.fetchone()[0]

    cur.execute(
        "INSERT INTO journal_lines (journal_id, account_id, debit_amount, credit_amount) VALUES (%s, %s, %s, %s)",
        (journal_id, 2001, amount, 0)  # Dr AP
    )
    cur.execute(
        "INSERT INTO journal_lines (journal_id, account_id, debit_amount, credit_amount) VALUES (%s, %s, %s, %s)",
        (journal_id, int(os.getenv("BANK_ACCOUNT_ID", 3001)), 0, amount)  # Cr Bank
    )

    conn.commit()
    cur.close()
    conn.close()

    return {**state, "next_state": "COMPLETED", "reason": "Payment executed successfully"}