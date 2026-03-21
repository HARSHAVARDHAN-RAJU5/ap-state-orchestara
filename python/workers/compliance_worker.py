from db import get_connection

def run(state: dict) -> dict:
    invoice_id = state["invoice_id"]
    organization_id = state["organization_id"]
    config = state.get("config", {})

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
    total_amount = float(invoice.get("total_amount") or 0)
    subtotal = float(invoice.get("subtotal") or 0)
    tax_amount = float(invoice.get("tax") or 0)
    gstin = invoice.get("gstin") or invoice.get("tax_id")

    # check gstin exists
    if not gstin:
        return {**state, "next_state": "BLOCKED", "reason": "GST number not provided"}

    # get vendor country from vendor_master
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT country_code FROM vendor_master WHERE tax_id = %s",
        (gstin,)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return {**state, "next_state": "BLOCKED", "reason": "Vendor not found for GST"}

    country_code = row[0]

    # get expected tax rate from tax_rules_master
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT expected_rate FROM tax_rules_master
        WHERE country_code = %s
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
        ORDER BY effective_from DESC
        LIMIT 1
        """,
        (country_code,)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return {**state, "next_state": "BLOCKED", "reason": "No tax rule found for country"}

    expected_rate = float(row[0])

    # calculate expected tax
    if not subtotal or not tax_amount:
        return {**state, "next_state": "BLOCKED", "reason": "Missing subtotal or tax amount"}

    expected_tax = subtotal * expected_rate
    difference = abs(expected_tax - tax_amount)

    # allow 1 rupee rounding tolerance
    tax_status = "PASS" if difference < 1 else "FAIL"

    # check high value flag
    high_value_threshold = config.get("approval", {}).get("high_value_threshold", float("inf"))
    high_value_flag = total_amount > high_value_threshold

    # save compliance results
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_compliance_results
            (invoice_id, organization_id, tax_status,
             high_value_flag, evaluated_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            tax_status = EXCLUDED.tax_status,
            high_value_flag = EXCLUDED.high_value_flag,
            evaluated_at = NOW()
        """,
        (invoice_id, organization_id, tax_status, high_value_flag)
    )
    conn.commit()
    cur.close()
    conn.close()

    # decide next state
    if tax_status == "FAIL":
        return {**state, "next_state": "BLOCKED", "reason": f"Tax mismatch. Expected: {expected_tax:.2f}, Got: {tax_amount:.2f}"}

    if high_value_flag:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": f"High value invoice: {total_amount} exceeds threshold"}

    return {**state, "next_state": "PAYMENT_READY", "reason": "Compliance passed"}