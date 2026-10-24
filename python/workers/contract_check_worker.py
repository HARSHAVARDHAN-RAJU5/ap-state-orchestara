import json

from db import get_connection
from rag.contract_check import run_all
from rag.requirements import check_requirements

DEFAULT_THRESHOLDS = {"min_confidence": 0.80, "min_similarity": 0.50}


def _fmt(value):
    return "n/a" if value is None else f"{value:g}"


def _describe(r):
    if r["check"] == "requirement":
        # layer 2 has no numbers: name the rule, where it comes from, and why it failed
        detail = r["explanation"] if r["status"] == "violation" else (r["problems"][0] if r["problems"] else "needs review")
        label = "not met" if r["status"] == "violation" else "needs review"
        return f"{r['section']} requirement '{r['target']}' {label}: {detail or 'not met'}"
    if r["status"] == "violation":
        return (f"{r['target']}: invoice {_fmt(r['invoice_value'])} vs {r['section']} "
                f"{_fmt(r['contract_value'])} - {r['explanation'] or 'violates contract'}")
    return f"{r['target']}: {r['problems'][0] if r['problems'] else 'needs review'}"


def run(state: dict) -> dict:
    invoice_id = state["invoice_id"]
    organization_id = state["organization_id"]
    thresholds = {**DEFAULT_THRESHOLDS, **((state.get("config") or {}).get("contract_check") or {})}

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT data, raw_text FROM invoice_extracted_data WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        return {**state, "next_state": None, "reason": "Extracted data not found"}
    invoice, raw_text = row

    gstin = invoice.get("gstin") or invoice.get("tax_id")
    cur.execute(
        "SELECT vendor_id FROM vendor_master WHERE tax_id = %s AND organization_id = %s",
        (gstin, organization_id)
    )
    row = cur.fetchone()
    vendor_id = row[0] if row else None

    cur.execute(
        """
        SELECT doc_type FROM contract_documents
        WHERE organization_id = %s AND (vendor_id = %s OR vendor_id IS NULL)
        """,
        (organization_id, vendor_id)
    )
    doc_types = {r[0] for r in cur.fetchall()}

    # compliance only flags high value now; the human review happens after this check
    cur.execute(
        "SELECT high_value_flag FROM invoice_compliance_results WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    high_value = bool(row and row[0])
    cur.close()
    conn.close()

    if not vendor_id:
        return {**state, "next_state": "EXCEPTION_REVIEW",
                "reason": f"Contract check: vendor not found for GST {gstin}"}

    has_contract = "contract" in doc_types
    if not doc_types:
        # nothing loaded for this org yet: the check cannot run, so it must not hold invoices
        results, decision = [], "PASS"
        summary = f"Contract check skipped ({vendor_id}): no contracts or policies loaded"
    else:
        results = run_all(organization_id, vendor_id, invoice, has_contract, thresholds)
        # layer 2: what the contract requires the invoice itself to contain (needs the pdf text)
        has_text = bool((raw_text or "").strip())
        if has_text:
            results += check_requirements(organization_id, vendor_id, raw_text, thresholds)
        issues = [r for r in results if r["status"] in ("violation", "review")]
        skipped = sum(r["status"] == "skipped" for r in results)
        scope = "" if has_contract else ", no contract on file - checked against policies only"
        if issues:
            decision = "REVIEW"
            summary = (f"Contract check ({vendor_id}{scope}): {len(issues)} of {len(results)} checks need review - "
                       + "; ".join(_describe(r) for r in issues))
        else:
            decision = "PASS"
            summary = (f"Contract check passed ({vendor_id}{scope}): {len(results)} checks"
                       + (f", {skipped} not covered" if skipped else ""))
        if not invoice.get("line_items"):
            summary += " [no line items extracted - prices and charges not checked]"
        if not has_text:
            summary += " [no invoice text saved (extracted before raw_text existed) - contract requirements not checked]"

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_contract_check_results
            (invoice_id, organization_id, vendor_id, decision, checks, reason, evaluated_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            vendor_id = EXCLUDED.vendor_id,
            decision = EXCLUDED.decision,
            checks = EXCLUDED.checks,
            reason = EXCLUDED.reason,
            evaluated_at = NOW()
        """,
        (invoice_id, organization_id, vendor_id, decision, json.dumps(results), summary)
    )
    conn.commit()
    cur.close()
    conn.close()

    reasons = [summary] if decision == "REVIEW" else []
    if high_value:
        reasons.append(f"High value invoice: {invoice.get('total_amount')} exceeds approval threshold")
    if reasons:
        return {**state, "next_state": "EXCEPTION_REVIEW", "reason": " | ".join(reasons)}
    return {**state, "next_state": "PAYMENT_READY", "reason": summary}
