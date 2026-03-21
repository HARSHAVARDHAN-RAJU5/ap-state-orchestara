from db import get_connection

def load_config(organization_id):
    conn = get_connection()
    cur = conn.cursor()

    # --- APPROVAL LEVELS ---
    cur.execute(
        "SELECT min_amount, max_amount, approver_role FROM approval_config WHERE organization_id = %s ORDER BY min_amount ASC",
        (organization_id,)
    )
    approval_rows = cur.fetchall()

    # --- MATCHING TOLERANCE ---
    cur.execute(
        "SELECT price_variance_percentage FROM matching_tolerance_config WHERE organization_id = %s",
        (organization_id,)
    )
    matching_row = cur.fetchone()

    cur.execute(
        "SELECT default_due_days, default_payment_method FROM payment_policy_config WHERE organization_id = %s",
        (organization_id,)
    )
    payment_row = cur.fetchone()

    cur.close()
    conn.close()

    levels = [
        {
            "min_amount": float(row[0]),
            "max_amount": float(row[1]),
            "approver_role": row[2]
        }
        for row in approval_rows
    ]

    high_value_threshold = max(l["min_amount"] for l in levels) if levels else float("inf")

    return {
        "approval": {
            "levels": levels,
            "high_value_threshold": high_value_threshold
        },
        "matching": {
            "price_variance_percentage": float(matching_row[0]) if matching_row else 0.02
        },
        "payment": {
            "default_due_days": payment_row[0] if payment_row else 30,
            "default_payment_method": payment_row[1] if payment_row else "BANK_TRANSFER"
        }
    }