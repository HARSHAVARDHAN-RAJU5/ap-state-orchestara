from db import get_connection

def run(state: dict) -> dict:
    invoice_id = state["invoice_id"]
    organization_id = state["organization_id"]

    # claim the latest unprocessed decision — atomic so a replayed event can't apply it twice
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE invoice_payment_approvals
        SET processed = true
        WHERE id = (
            SELECT id FROM invoice_payment_approvals
            WHERE invoice_id = %s
            AND organization_id = %s
            AND processed = false
            ORDER BY decided_at DESC
            LIMIT 1
        )
        RETURNING decision, reviewer_name, reviewer_role
        """,
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()

    if not row:
        return {**state, "next_state": "PENDING_APPROVAL", "reason": "Waiting for payment approval decision"}

    decision, reviewer_name, reviewer_role = row

    if decision == "APPROVE":
        return {**state, "next_state": "ACCOUNTING", "reason": f"Payment approved by {reviewer_name} ({reviewer_role})"}

    if decision == "REJECT":
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": f"Payment rejected by {reviewer_name} ({reviewer_role}) — escalated for review"}

    return {**state, "next_state": "PENDING_APPROVAL", "reason": f"Unknown approval decision: {decision}"}
