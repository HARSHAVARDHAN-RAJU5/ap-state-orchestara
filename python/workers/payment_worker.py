from db import get_connection
from datetime import datetime, timedelta

def run(state: dict) -> dict:
    invoice_id = state["invoice_id"]
    organization_id = state["organization_id"]
    config = state.get("config", {})

    # check state is PAYMENT_READY
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT current_state FROM invoice_state_machine WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row or row[0] != "PAYMENT_READY":
        return {**state, "next_state": None, "reason": "Wrong state for payment scheduling"}

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
    payment_config = config.get("payment", {})

    # calculate due date
    due_date = None

    if invoice.get("due_date"):
        try:
            due_date = datetime.strptime(str(invoice["due_date"]), "%Y-%m-%d")
        except:
            pass

    if not due_date:
        default_days = payment_config.get("default_due_days", 30)
        due_date = datetime.now() + timedelta(days=default_days)

    payment_method = (
        invoice.get("payment_method") or
        payment_config.get("default_payment_method") or
        "BANK_TRANSFER"
    )

    # get approval tier for this invoice amount
    total_amount = float(invoice.get("total_amount") or 0)
    levels = config.get("approval", {}).get("levels", [])
    levels_sorted = sorted(levels, key=lambda x: x["min_amount"], reverse=True)
    matched_level = next(
        (l for l in levels_sorted if total_amount >= l["min_amount"]),
        None
    )

    if not matched_level:
        return {**state, "next_state": None, "reason": "No matching approval tier found"}

    required_approval_level = matched_level["approver_role"]

    # save payment schedule
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_payment_schedule
            (invoice_id, organization_id, payment_status,
             payment_due_date, payment_method, scheduled_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            payment_status = EXCLUDED.payment_status,
            payment_due_date = EXCLUDED.payment_due_date,
            payment_method = EXCLUDED.payment_method
        """,
        (invoice_id, organization_id, "SCHEDULED", due_date, payment_method)
    )
    conn.commit()
    cur.close()
    conn.close()

    # save approval workflow
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_approval_workflow
            (invoice_id, organization_id, approval_level,
             required_approval_level, approval_status, created_at)
        VALUES (%s, %s, %s, %s, 'PENDING', NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            approval_level = EXCLUDED.approval_level,
            required_approval_level = EXCLUDED.required_approval_level,
            approval_status = EXCLUDED.approval_status
        """,
        (invoice_id, organization_id, required_approval_level, required_approval_level)
    )
    conn.commit()
    cur.close()
    conn.close()

    return {**state, "next_state": "PENDING_APPROVAL", "reason": f"Payment scheduled. Requires approval from: {required_approval_level}"}