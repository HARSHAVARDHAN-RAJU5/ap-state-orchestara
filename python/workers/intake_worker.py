from db import get_connection
from policy_engine import load_config
from llm import generate_json
import pdfplumber
import json


def to_number(value):
    # null stays null: a missing quantity / price must not turn into 0
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", "").replace("₹", "").strip())
    except ValueError:
        return None


def clean_line_items(items):
    if not isinstance(items, list):
        return []
    cleaned = []
    for item in items:
        if not isinstance(item, dict) or not item.get("description"):
            continue
        cleaned.append({
            "description": str(item["description"]).strip(),
            "quantity": to_number(item.get("quantity")),
            "unit_price": to_number(item.get("unit_price")),
            "amount": to_number(item.get("amount")),
        })
    return cleaned


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

    # send to the llm (gemini by default, see llm.py)
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
- line_items: a list with one object per billed row, in the order shown on the invoice.
  Each object has: description, quantity, unit_price, amount.
  Include every charge row (products, services, freight, delivery, handling, fees).
  Do not include subtotal, tax or total rows.

If a field is missing return null.
If a line item's quantity or unit_price is not printed on the invoice, return null for it - do not calculate or guess.
Remove currency symbols from numbers.

Invoice Text:
{text}
"""

    try:
        data = generate_json(prompt)
    except json.JSONDecodeError:
        return {**state, "next_state": None, "reason": "LLM returned invalid JSON"}
    except Exception as e:
        return {**state, "next_state": None, "reason": f"LLM call failed: {str(e)}"}

    # fallback defaults
    if not data.get("expense_category"):
        data["expense_category"] = "GENERAL"

    # clean amount fields
    for field in ["subtotal", "tax", "total_amount"]:
        if data.get(field):
            data[field] = float(str(data[field]).replace(",", "").replace("₹", ""))

    data["line_items"] = clean_line_items(data.get("line_items"))

    # save to DB
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO invoice_extracted_data
            (invoice_id, organization_id, data, raw_text, extraction_status, extracted_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (invoice_id, organization_id)
        DO UPDATE SET
            data = EXCLUDED.data,
            raw_text = EXCLUDED.raw_text,
            extraction_status = EXCLUDED.extraction_status,
            extracted_at = NOW()
        """,
        # raw text kept for the contract requirement check (what the vendor actually wrote)
        (invoice_id, organization_id, json.dumps(data), text, "SUCCESS")
    )
    conn.commit()
    cur.close()
    conn.close()

    return {**state, "current_state": "RECEIVED", "next_state": "STRUCTURED", "reason": "Extraction completed"}