from db import get_connection

def run(state: dict) -> dict:
    invoice_id = state["invoice_id"]
    organization_id = state["organization_id"]

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT review_cycle FROM invoice_state_machine WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    review_cycle = row[0] if row and row[0] is not None else 0

    # claim the decision for this review cycle only — atomic so it's applied once
    cur.execute(
        """
        UPDATE exception_review_decisions
        SET processed = true
        WHERE id = (
            SELECT id FROM exception_review_decisions
            WHERE invoice_id = %s
            AND organization_id = %s
            AND processed = false
            AND review_cycle = %s
            ORDER BY decided_at DESC
            LIMIT 1
        )
        RETURNING decision, reason, reviewer_name
        """,
        (invoice_id, organization_id, review_cycle)
    )
    decision_row = cur.fetchone()

    # escalation opens a new review cycle so the next reviewer can decide
    if decision_row and decision_row[0] == "ESCALATE":
        cur.execute(
            """
            UPDATE invoice_state_machine
            SET review_cycle = COALESCE(review_cycle, 0) + 1
            WHERE invoice_id = %s AND organization_id = %s
            """,
            (invoice_id, organization_id)
        )

    conn.commit()
    cur.close()
    conn.close()

    if not decision_row:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": "Waiting for reviewer decision"}

    decision, comment, reviewer_name = decision_row

    # approve goes back through payment scheduling for a fresh sign-off — never straight to paid
    if decision == "APPROVE":
        return {**state, "next_state": "PAYMENT_READY", "reason": f"Exception resolved by {reviewer_name}"}

    if decision == "ESCALATE":
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": f"Escalated by {reviewer_name}"}

    if decision == "BLOCK":
        return {**state, "next_state": "BLOCKED", "reason": comment or f"Blocked by {reviewer_name}"}

    return {**state, "next_state": "EXCEPTION_REVIEW", "reason": f"Unknown review decision: {decision}"}
