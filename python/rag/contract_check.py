"""
Contract check core: retrieve clauses, ask the llm for a verdict with a verbatim quote,
then verify that verdict with code. Shared by workers/contract_check_worker.py and rag.eval_answers.

The llm only suggests. The status of each check is decided here:
  pass       compliant and every code check agrees
  violation  verified violation                         -> human review
  review     unsure, unverifiable, not covered, error   -> human review
  skipped    not covered and the vendor has no contract (policies only; nothing to compare)
"""
import json
import re
from datetime import date

from llm import generate_json
from rag.retrieve import build_query, search

K = 3
VERDICTS = {"compliant", "violation", "not_covered"}
TOLERANCE = 1  # 1-unit rounding tolerance, same as tax/total math


def _norm(text):
    text = (text or "").lower()
    text = re.sub(r"[‐-―]", "-", text)                  # dashes
    text = text.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip().rstrip(".")


def _numbers(text):
    return [float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text or "")]


def _close(a, b):
    return abs(float(a) - float(b)) <= TOLERANCE


def _num(value):
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def days_between(invoice_date, due_date):
    try:
        return (date.fromisoformat(str(due_date)[:10]) - date.fromisoformat(str(invoice_date)[:10])).days
    except (TypeError, ValueError):
        return None


def section_label(chunk):
    num = chunk["section_title"].split(".")[0].strip()
    owner = chunk["vendor_id"] or chunk["doc_name"].split(" - ")[0]
    return f"{owner} §{num}"


def _retrieve(organization_id, vendor_id, queries):
    # union of several queries, best similarity per chunk
    best = {}
    for q in queries:
        for r in search(organization_id, vendor_id, q, k=K):
            if r["chunk_id"] not in best or r["similarity"] > best[r["chunk_id"]]["similarity"]:
                best[r["chunk_id"]] = r
    return sorted(best.values(), key=lambda r: r["similarity"], reverse=True)


PROMPT = """You check ONE item of a vendor invoice against contract and company policy excerpts.
Use only what the excerpts say. Return ONLY JSON.

Vendor contract on file: {has_contract}

Invoice:
{invoice}

Item to check:
{target}

Excerpts (id in brackets):
{excerpts}

Rules:
- verdict: "violation" if the item breaks a rule in the excerpts, "compliant" if a rule allows it,
  "not_covered" if no excerpt contains a rule about this item.
- Payment terms: a violation only when the invoice asks for payment in FEWER days than allowed.
  More days than agreed is compliant.
- Prices: a violation when the billed unit price is above the contract price.
- Extra charges (freight, delivery, handling, fees): compliant only if an excerpt explicitly allows
  the charge. Apply any condition in the rule (for example an order value threshold) using the invoice data.
- Prefer the vendor contract clause. Cite a company policy only if the contract has no rule for this item
  or the policy sets a stricter limit.
- chunk_id: the id of the excerpt you rely on (null if not_covered).
- quote: the single most relevant sentence copied EXACTLY, character for character, from that excerpt.
- contract_value: the number the rule sets (days, price per unit, or allowed charge amount);
  0 if the rule says this charge may not be billed; null if the rule has no number.
- invoice_value: the matching number from the invoice. Compare like with like: per-unit rule -> unit price,
  charge rule -> charge amount, payment rule -> days.
- confidence: 0 to 1, how sure you are of the verdict.

JSON shape:
{{"verdict": "...", "chunk_id": 0, "quote": "...", "contract_value": 0, "invoice_value": 0,
  "confidence": 0.0, "explanation": "one short sentence"}}"""


def _ask(invoice_context, target, excerpts, has_contract):
    blocks = "\n\n".join(
        f"[{c['chunk_id']}] {c['doc_name']} - {c['section_title']}\n{c['content']}" for c in excerpts
    )
    prompt = PROMPT.format(
        has_contract="yes" if has_contract else "no (only company policies apply)",
        invoice=json.dumps(invoice_context, indent=1, ensure_ascii=False),
        target=target,
        excerpts=blocks,
    )
    return generate_json(prompt)


def _verify(check, target_label, answer, excerpts, invoice_values, kind, has_contract, thresholds):
    result = {
        "check": check, "target": target_label,
        "verdict": None, "status": "review", "problems": [],
        "chunk_id": None, "section": None, "quote": None,
        "contract_value": None, "invoice_value": None,
        "llm_confidence": None, "similarity": None,
        "quote_verified": False, "numbers_agree": None, "explanation": None,
    }
    problems = result["problems"]

    verdict = str(answer.get("verdict") or "").lower()
    result.update({
        "verdict": verdict,
        "quote": answer.get("quote"),
        "contract_value": _num(answer.get("contract_value")),
        "invoice_value": _num(answer.get("invoice_value")),
        "llm_confidence": _num(answer.get("confidence")),
        "explanation": answer.get("explanation"),
    })

    if verdict not in VERDICTS:
        problems.append(f"llm returned an unknown verdict '{verdict}'")
        return result

    if verdict == "not_covered":
        if has_contract:
            problems.append("no contract or policy clause covers this item")
        else:
            result["status"] = "skipped"
        return result

    # the cited clause must be one we actually retrieved
    by_id = {c["chunk_id"]: c for c in excerpts}
    try:
        chunk = by_id.get(int(answer.get("chunk_id")))
    except (TypeError, ValueError):
        chunk = None
    if not chunk:
        problems.append(f"cited clause {answer.get('chunk_id')} was not among the retrieved clauses")
        return result

    result.update({"chunk_id": chunk["chunk_id"], "section": section_label(chunk),
                   "similarity": round(chunk["similarity"], 3)})

    # the quote must exist verbatim in that clause
    quote = _norm(result["quote"])
    result["quote_verified"] = len(quote) >= 10 and quote in _norm(chunk["content"])
    if not result["quote_verified"]:
        problems.append("quote not found in the cited clause")

    contract_value, invoice_value = result["contract_value"], result["invoice_value"]

    # the contract number must come from the quote, not from the llm's imagination
    if contract_value not in (None, 0) and not any(_close(contract_value, n) for n in _numbers(result["quote"])):
        problems.append(f"contract value {contract_value:g} does not appear in the quote")

    # the invoice number must match what code read from the invoice
    if invoice_value is None or not any(_close(invoice_value, v) for v in invoice_values if v is not None):
        problems.append(f"invoice value {invoice_value} does not match the invoice "
                        f"({', '.join(f'{v:g}' for v in invoice_values if v is not None) or 'none'})")
    elif contract_value is not None:
        # recompute the verdict from the numbers
        if kind == "days":
            code_verdict = "violation" if invoice_value < contract_value else "compliant"
        else:
            code_verdict = "violation" if invoice_value > contract_value + TOLERANCE else "compliant"
        result["numbers_agree"] = code_verdict == verdict
        if not result["numbers_agree"]:
            problems.append(f"llm said {verdict} but the numbers say {code_verdict} "
                            f"(invoice {invoice_value:g}, contract {contract_value:g})")

    confidence = result["llm_confidence"] or 0
    if confidence < thresholds["min_confidence"]:
        problems.append(f"llm confidence {confidence:.2f} below {thresholds['min_confidence']:.2f}")
    if chunk["similarity"] < thresholds["min_similarity"]:
        problems.append(f"clause match {chunk['similarity']:.2f} below {thresholds['min_similarity']:.2f}")

    if not problems:
        result["status"] = "violation" if verdict == "violation" else "pass"
    return result


def _error(check, target_label, message):
    return {"check": check, "target": target_label, "verdict": None, "status": "review",
            "problems": [message], "chunk_id": None, "section": None, "quote": None,
            "contract_value": None, "invoice_value": None, "llm_confidence": None,
            "similarity": None, "quote_verified": False, "numbers_agree": None, "explanation": None}


def check_payment_terms(organization_id, vendor_id, invoice, has_contract, thresholds):
    label = "payment terms"
    days = days_between(invoice.get("invoice_date"), invoice.get("due_date"))
    if days is None:
        return _error("payment_terms", label, "invoice date or due date missing - cannot check payment terms")
    try:
        excerpts = _retrieve(organization_id, vendor_id, [build_query("payment_terms", invoice)])
        context = {"invoice_date": invoice.get("invoice_date"), "due_date": invoice.get("due_date"),
                   "days_until_due": days}
        # "within N days" read as an upper limit made the llm call fewer days compliant - state it as a request
        target = (f"Payment terms: the vendor wants to be paid {days} days after the invoice date. "
                  f"Find how many days the contract (or policy) gives the company to pay. "
                  f"If the vendor wants the money sooner than that (fewer days), it is a violation. "
                  f"The same or more days is compliant.")
        answer = _ask(context, target, excerpts, has_contract)
    except Exception as e:
        return _error("payment_terms", label, f"check failed: {e}")
    return _verify("payment_terms", label, answer, excerpts, [days], "days", has_contract, thresholds)


def check_line(organization_id, vendor_id, invoice, item, has_contract, thresholds):
    label = item.get("description") or "line item"
    others = [i for i in invoice.get("line_items", []) if i is not item]
    order_value = sum(_num(i.get("amount")) or 0 for i in others)
    try:
        queries = [build_query("unit_price", invoice, item), build_query("extra_charges", invoice, item)]
        excerpts = _retrieve(organization_id, vendor_id, queries)
        context = {"line_items": invoice.get("line_items", []),
                   "order_value_excluding_this_line": order_value}
        # conditional charges (e.g. "free above 10,000") were judged without the condition - spell it out
        target = (f"Line item '{label}': quantity {item.get('quantity')}, unit price {item.get('unit_price')}, "
                  f"amount {item.get('amount')}. The other lines on this invoice add up to {order_value:g}. "
                  f"Is this price or charge allowed? If the contract allows it only under a condition "
                  f"(for example an order value above or below a limit), check that condition with {order_value:g}; "
                  f"if the condition is not met, it is a violation.")
        answer = _ask(context, target, excerpts, has_contract)
    except Exception as e:
        return _error("line_item", label, f"check failed: {e}")
    values = [_num(item.get("unit_price")), _num(item.get("amount"))]
    return _verify("line_item", label, answer, excerpts, values, "amount", has_contract, thresholds)


def run_all(organization_id, vendor_id, invoice, has_contract, thresholds):
    results = [check_payment_terms(organization_id, vendor_id, invoice, has_contract, thresholds)]
    for item in invoice.get("line_items") or []:
        results.append(check_line(organization_id, vendor_id, invoice, item, has_contract, thresholds))
    return results
