from db import get_connection
from datetime import datetime, timezone

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
    total_amount = float(invoice.get("total_amount") or 0)
    vendor_name = invoice.get("vendor_name")
    invoice_date = invoice.get("invoice_date")

    risk_score = 0
    signals = []

    # signal 1 — round amount
    if total_amount > 0 and total_amount % 1000 == 0:
        risk_score += 15
        signals.append("ROUND_AMOUNT")

    # signal 2 — first time vendor
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*) FROM invoice_extracted_data
        WHERE organization_id = %s
        AND data->>'vendor_name' = %s
        AND invoice_id != %s
        """,
        (organization_id, vendor_name, invoice_id)
    )
    vendor_count = cur.fetchone()[0]
    cur.close()
    conn.close()

    if vendor_count == 0:
        risk_score += 20
        signals.append("FIRST_TIME_VENDOR")

    # signal 3 — rapid resubmission (same vendor 2+ invoices in last 24 hours)
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*) FROM invoice_extracted_data
        WHERE organization_id = %s
        AND data->>'vendor_name' = %s
        AND invoice_id != %s
        AND extracted_at >= NOW() - INTERVAL '24 hours'
        """,
        (organization_id, vendor_name, invoice_id)
    )
    recent_count = cur.fetchone()[0]
    cur.close()
    conn.close()

    if recent_count >= 2:
        risk_score += 25
        signals.append("RAPID_RESUBMISSION")

    # signal 4 — backdated invoice (invoice date > 30 days ago)
    if invoice_date:
        try:
            inv_date = datetime.strptime(str(invoice_date), "%Y-%m-%d")
            days_old = (datetime.now() - inv_date).days
            if days_old > 30:
                risk_score += 20
                signals.append("BACKDATED_INVOICE")
        except:
            pass

    # signal 5 — amount spike (> 2.5x vendor historical average)
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT AVG((data->>'total_amount')::numeric)
        FROM invoice_extracted_data
        WHERE organization_id = %s
        AND data->>'vendor_name' = %s
        AND invoice_id != %s
        """,
        (organization_id, vendor_name, invoice_id)
    )
    avg_row = cur.fetchone()
    cur.close()
    conn.close()

    if avg_row and avg_row[0]:
        historical_avg = float(avg_row[0])
        if historical_avg > 0 and total_amount > historical_avg * 2.5:
            risk_score += 25
            signals.append("AMOUNT_SPIKE")

    # signal 6 — PO reuse (same PO number on multiple invoices)
    po_number = invoice.get("po_number")
    if po_number:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT COUNT(*) FROM invoice_po_matching_results
            WHERE organization_id = %s
            AND po_number = %s
            AND invoice_id != %s
            """,
            (organization_id, po_number, invoice_id)
        )
        po_reuse_count = cur.fetchone()[0]
        cur.close()
        conn.close()

        if po_reuse_count > 0:
            risk_score += 30
            signals.append("PO_REUSE")

    # save fraud score
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_fraud_scores
            (invoice_id, organization_id, risk_score, signals, evaluated_at)
        VALUES (%s, %s, %s, %s::jsonb, NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            risk_score = EXCLUDED.risk_score,
            signals = EXCLUDED.signals,
            evaluated_at = NOW()
        """,
        (invoice_id, organization_id, risk_score, str(signals).replace("'", '"'))
    )
    conn.commit()
    cur.close()
    conn.close()

    # decide next state based on score
    if risk_score > 60:
        return {**state, "next_state": "BLOCKED", "reason": f"High fraud risk score: {risk_score}. Signals: {signals}"}

    if risk_score >= 30:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": f"Medium fraud risk score: {risk_score}. Signals: {signals}"}

    return {**state, "next_state": "COMPLIANCE", "reason": f"Fraud check passed. Score: {risk_score}"}