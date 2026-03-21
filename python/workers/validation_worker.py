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
        return {**state, "next_state": None, "reason": "Extracted data not found"}

    invoice = row[0]

    # check required fields
    missing = []
    for field in ["invoice_number", "vendor_name", "total_amount", "invoice_date"]:
        if not invoice.get(field):
            missing.append(field)

    if missing:
        return {**state, "next_state": "WAITING_INFO", "reason": f"Missing fields: {', '.join(missing)}"}

    # check math — subtotal + tax should equal total
    subtotal = float(invoice.get("subtotal") or 0)
    tax = float(invoice.get("tax") or 0)
    total = float(invoice.get("total_amount") or 0)

    if subtotal and tax and abs(subtotal + tax - total) > 1:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": f"Total mismatch: {subtotal} + {tax} != {total}"}

    # check vendor exists in vendor_master
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT vendor_id, bank_account, status, tax_id
        FROM vendor_master
        WHERE organization_id = %s
        AND (legal_name ILIKE %s OR tax_id = %s)
        LIMIT 1
        """,
        (organization_id, invoice.get("vendor_name"), invoice.get("gstin") or "")
    )
    vendor = cur.fetchone()
    cur.close()
    conn.close()

    if not vendor:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": f"Vendor not found: {invoice.get('vendor_name')}"}

    vendor_id, bank_account, status, tax_id = vendor

    # check vendor is active
    legal_status = "PASS" if status == "ACTIVE" else "FAIL"

    if legal_status == "FAIL":
        return {**state, "next_state": "BLOCKED", "reason": "Vendor is inactive"}

    # check bank account
    invoice_bank = invoice.get("bank_account")
    bank_status = "MISMATCH" if invoice_bank and invoice_bank != bank_account else "PASS"

    # check tax id
    tax_status = "PASS" if invoice.get("gstin") and tax_id == invoice.get("gstin") else "UNVERIFIED"

    # determine overall status
    if bank_status == "MISMATCH":
        overall_status = "REVIEW_REQUIRED"
    elif tax_status == "UNVERIFIED":
        overall_status = "REVIEW_REQUIRED"
    else:
        overall_status = "VALID"

    # save to invoice_validation_results
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_validation_results
            (invoice_id, organization_id, vendor_id,
             legal_status, tax_status, bank_status,
             overall_status, validated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            vendor_id = EXCLUDED.vendor_id,
            legal_status = EXCLUDED.legal_status,
            tax_status = EXCLUDED.tax_status,
            bank_status = EXCLUDED.bank_status,
            overall_status = EXCLUDED.overall_status,
            validated_at = NOW()
        """,
        (invoice_id, organization_id, vendor_id,
         legal_status, tax_status, bank_status, overall_status)
    )
    conn.commit()
    cur.close()
    conn.close()

    # decide next state
    if overall_status == "REVIEW_REQUIRED":
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": bank_status == "MISMATCH" and "Bank account mismatch" or "Tax ID unverified"}

    return {**state, "next_state": "MATCHING", "reason": "Vendor validated successfully"}