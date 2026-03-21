from db import get_connection
from policy_engine import load_config
import pdfplumber
import requests
import json

def run(state: dict) -> dict:
    invoice_id = state["invoice_id"]
    organization_id = state["organization_id"]
    config = load_config(organization_id)

    # check state first
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT current_state FROM invoice_state_machine WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row or row[0] != "RECEIVED":
        return {**state, "next_state": None, "reason": "Wrong state for intake"}

    # get file path
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT file_path FROM invoices WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return {**state, "next_state": None, "reason": "Invoice file not found"}

    file_path = row[0]

    # extract text from pdf
    text = ""
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text += page.extract_text() or ""

    if len(text.strip()) < 20:
        return {**state, "next_state": None, "reason": "PDF text too short or empty"}

    # send to llama3
    prompt = f"""
You are an invoice extraction engine.
Extract these fields from the invoice text below and return ONLY valid JSON, no explanation:

- invoice_number
- vendor_name
- gstin
- subtotal
- tax
- total_amount
- invoice_date
- due_date
- po_number
- expense_category (one of: SOFTWARE, OFFICE_SUPPLIES, TRAVEL, UTILITIES, GENERAL)

If a field is missing return null.
Remove currency symbols from numbers.

Invoice Text:
{text}
"""

    try:
        response = requests.post(
            "http://127.0.0.1:11434/api/generate",
            json={"model": "llama3", "prompt": prompt, "stream": False},
            timeout=60
        )
        raw = response.json()["response"]
    except Exception as e:
        return {**state, "next_state": None, "reason": f"LLM call failed: {str(e)}"}

    # clean and parse llm response
    clean = raw.strip()
    if "```" in clean:
        clean = clean.split("```")[1]
        if clean.startswith("json"):
            clean = clean[4:]

    try:
        data = json.loads(clean)
    except json.JSONDecodeError:
        return {**state, "next_state": None, "reason": "LLM returned invalid JSON"}

    # fallback defaults
    if not data.get("expense_category"):
        data["expense_category"] = "GENERAL"

    # clean amount fields
    for field in ["subtotal", "tax", "total_amount"]:
        if data.get(field):
            data[field] = float(str(data[field]).replace(",", "").replace("₹", ""))

    # save to DB
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_extracted_data
            (invoice_id, organization_id, data, extraction_status, extracted_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            data = EXCLUDED.data,
            extraction_status = EXCLUDED.extraction_status,
            extracted_at = NOW()
        """,
        (invoice_id, organization_id, json.dumps(data), "SUCCESS")
    )
    conn.commit()
    cur.close()
    conn.close()

    return {**state, "current_state": "RECEIVED", "next_state": "STRUCTURED", "reason": "Extraction completed"}