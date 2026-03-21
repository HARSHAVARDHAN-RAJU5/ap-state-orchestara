from db import get_connection
from rapidfuzz import fuzz

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
    invoice_total = float(invoice.get("total_amount") or 0)
    invoice_vendor = (invoice.get("vendor_name") or "").strip().lower()
    po_number = invoice.get("po_number")

    # get vendor_id from validation results
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT vendor_id, bank_status FROM invoice_validation_results WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return {**state, "next_state": None, "reason": "Validation results not found"}

    vendor_id, bank_status = row
    tolerance = config.get("matching", {}).get("price_variance_percentage", 0.02)
    bank_mismatch_flag = bank_status == "MISMATCH"

    po = None
    missing_po_flag = False
    price_variance_flag = False

    # try to find PO by po_number first
    if po_number:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM purchase_orders WHERE po_number = %s AND organization_id = %s",
            (po_number, organization_id)
        )
        po = cur.fetchone()
        cur.close()
        conn.close()

    # if not found by po_number — fuzzy match by vendor name + amount
    if not po:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT po.*, vm.legal_name 
            FROM purchase_orders po
            JOIN vendor_master vm ON po.vendor_id = vm.vendor_id
            WHERE po.organization_id = %s
            """,
            (organization_id,)
        )
        all_pos = cur.fetchall()
        cur.close()
        conn.close()

        best_match = None
        best_score = 0

        for p in all_pos:
            po_amount = float(p[3] or 0)
            po_vendor_name = (p[-1] or "").strip().lower()  # legal_name from join

            if not po_amount:
                continue

            # amount check
            amount_variance = abs(invoice_total - po_amount) / po_amount
            amount_ok = amount_variance <= tolerance

            # fuzzy vendor name check
            name_score = fuzz.ratio(invoice_vendor, po_vendor_name)
            name_ok = name_score >= 80

            # both must pass
            if amount_ok and name_ok:
                # pick the best name score among matches
                combined_score = name_score + (1 - amount_variance) * 100
                if combined_score > best_score:
                    best_score = combined_score
                    best_match = p

        if best_match:
            po = best_match
        else:
            missing_po_flag = True

    # check price variance if PO found
    if po:
        po_amount = float(po[3] or 0)
        if po_amount and abs(invoice_total - po_amount) / po_amount > tolerance:
            price_variance_flag = True

    # save matching results
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_po_matching_results
            (invoice_id, organization_id, po_number,
             matching_status, missing_po_flag,
             price_variance_flag, bank_mismatch_flag, matched_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            po_number = EXCLUDED.po_number,
            matching_status = EXCLUDED.matching_status,
            missing_po_flag = EXCLUDED.missing_po_flag,
            price_variance_flag = EXCLUDED.price_variance_flag,
            bank_mismatch_flag = EXCLUDED.bank_mismatch_flag,
            matched_at = NOW()
        """,
        (
            invoice_id, organization_id,
            po[1] if po else None,
            "MATCHED" if po else "MISMATCH",
            missing_po_flag, price_variance_flag, bank_mismatch_flag
        )
    )
    conn.commit()
    cur.close()
    conn.close()

    # decide next state
    if bank_mismatch_flag:
        return {**state, "next_state": "WAITING_INFO", "reason": "Vendor bank account mismatch"}

    if missing_po_flag:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": "No matching purchase order found"}

    if price_variance_flag:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": "Invoice amount exceeds PO tolerance"}

    return {**state, "next_state": "FRAUD_SCREENING", "reason": "PO matched successfully"}