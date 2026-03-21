from db import get_connection

def run(state: dict) -> dict:
    invoice_id = state["invoice_id"]
    organization_id = state["organization_id"]

    # get extracted data
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
        return {**state, "next_state": None, "reason": "No extracted data found"}

    data = row[0]
    invoice_number = data.get("invoice_number")
    vendor_name = data.get("vendor_name")
    total_amount = data.get("total_amount")

    if not invoice_number or not vendor_name or not total_amount:
        return {**state, "next_state": None, "reason": "Missing required fields"}

    # check paid registry — was this invoice already paid before?
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT 1 FROM paid_invoice_registry
        WHERE organization_id = %s
        AND invoice_number = %s
        AND vendor_name = %s
        LIMIT 1
        """,
        (organization_id, invoice_number, vendor_name)
    )
    already_paid = cur.fetchone()
    cur.close()
    conn.close()

    if already_paid:
        return {**state, "next_state": "BLOCKED", "reason": "Invoice already paid previously"}

    # check current pipeline — is there another invoice with same number + vendor + amount?
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*) FROM invoice_extracted_data
        WHERE organization_id = %s
        AND data->>'invoice_number' = %s
        AND data->>'vendor_name' = %s
        AND (data->>'total_amount')::numeric = %s
        AND invoice_id != %s
        """,
        (organization_id, invoice_number, vendor_name, total_amount, invoice_id)
    )
    count = cur.fetchone()[0]
    cur.close()
    conn.close()

    if count == 0:
        return {**state, "next_state": "VALIDATING", "reason": "No duplicate found"}

    if count == 1:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": "Potential duplicate — needs review"}

    return {**state, "next_state": "BLOCKED", "reason": "Duplicate invoice confirmed"}