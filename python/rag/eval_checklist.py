"""
Checklist eval: compare contract_requirements (built by rag.requirements) with data/eval/checklist_truth.json.

    cd python
    venv\\Scripts\\python.exe -B -m rag.eval_checklist --label baseline

Scores:
  recall           expected requirements found (any status)
  usable recall    expected requirements found AND auto_approved / approved (what invoices are checked against)
  precision        built requirements that match an expected one (strict) / or an acceptable borderline one (lenient)
  auto-approval    share of built requirements the code verified without a human
"""
import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path

from db import get_connection
from rag.contract_check import _norm

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "eval"

# when two expected rules share one sentence ("quote the po number and reference VEN-001"), the
# requirement text decides which one a built item is about
ALIASES = {"purchase order number": ["purchase order", "po"],
           "one invoice per month": ["per month", "monthly", "once a month"]}


def section_number(section_title):
    return section_title.split(".")[0].strip()


def _mentions(text, phrase):
    words = [phrase] + ALIASES.get(phrase, [])
    words += re.findall(r"ven-\d+", phrase)
    return any(re.search(rf"(?<![\w-]){re.escape(w)}(?![\w-])", text) for w in words)


def match_keys(item, expected):
    """expected entries this built item counts for. item needs section_title, quote, requirement."""
    quote = _norm(item["quote"])
    cands = [e for e in expected
             if section_number(item["section_title"]) == e["section"]
             and any(_norm(p) in quote for p in e["phrases"])]
    if len(cands) > 1:
        req = _norm(item["requirement"])
        narrowed = [e for e in cands if any(_mentions(req, _norm(p)) for p in e["phrases"])]
        cands = narrowed or cands
    return cands


def load_built(organization_id):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT d.doc_name, r.requirement_id, r.section_title, r.requirement, r.quote, r.needs,
               r.status, r.problems, r.llm_confidence, r.second_check
        FROM contract_requirements r
        JOIN contract_documents d ON d.document_id = r.document_id AND d.organization_id = r.organization_id
        WHERE r.organization_id = %s ORDER BY r.document_id, r.requirement_id
        """,
        (organization_id,)
    )
    cols = ["doc_name", "requirement_id", "section_title", "requirement", "quote", "needs",
            "status", "problems", "llm_confidence", "second_check"]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


def main():
    parser = argparse.ArgumentParser(description="score the requirements checklist against checklist_truth.json")
    parser.add_argument("--label", default="run")
    args = parser.parse_args()

    truth = json.loads((DATA_DIR / "checklist_truth.json").read_text(encoding="utf-8"))
    org = truth["organization_id"]
    built = load_built(org)

    n_expected = found = usable = needs_ok = 0
    strict_ok = lenient_ok = 0
    misses, extras, duplicates, per_doc = [], [], [], []

    for doc in truth["documents"]:
        items = [b for b in built if b["doc_name"] == doc["doc_name"]]
        hits = {e["key"]: [] for e in doc["expected"]}
        doc_extras = []
        for b in items:
            keys = match_keys(b, doc["expected"])
            b["matched"] = [e["key"] for e in keys]
            for e in keys:
                hits[e["key"]].append(b)
            if keys:
                strict_ok += 1
                lenient_ok += 1
            elif match_keys(b, doc["acceptable_extras"]):
                lenient_ok += 1
                b["matched"] = ["(acceptable extra)"]
                doc_extras.append(b)
            else:
                doc_extras.append(b)

        for e in doc["expected"]:
            n_expected += 1
            got = hits[e["key"]]
            if not got:
                misses.append(e["key"])
                continue
            found += 1
            if any(g["status"] in ("auto_approved", "approved") for g in got):
                usable += 1
            if any(g["needs"] == e["needs"] for g in got):
                needs_ok += 1
            if len(got) > 1:
                duplicates.append(f"{e['key']}: {len(got)} items {[g['requirement_id'] for g in got]}")
        extras += [f"{doc['doc_name'][:40]} {b['section_title']} [{b['status']}]"
                   f"{' (acceptable)' if b['matched'] else ''}: {b['requirement']}" for b in doc_extras]
        per_doc.append({"doc_name": doc["doc_name"], "built": items, "misses": [k for k in hits if not hits[k]]})

    n_built = len(built)
    auto = sum(b["status"] == "auto_approved" for b in built)
    pct = lambda a, b: f"{a}/{b} = {a / b:.0%}" if b else f"{a}/0"

    for d in per_doc:
        print(f"\n{d['doc_name']}")
        for b in d["built"]:
            tag = ", ".join(b["matched"]) or "EXTRA"
            print(f"  {b['requirement_id']:>4} [{b['status']:<13}] {b['section_title']:<22} ({b['needs']}) "
                  f"{b['requirement']}  -> {tag}")
            for p in b["problems"]:
                print(f"         - {p}")
        for k in d["misses"]:
            print(f"  MISS {k}")

    llm = f"{os.getenv('LLM_PROVIDER', 'gemini')}:{os.getenv('GEMINI_MODEL', 'gemini-3.8-flash')}"
    print(f"\n[{llm}]  {n_built} built, {n_expected} expected")
    print(f"recall:            {pct(found, n_expected)}")
    print(f"usable recall:     {pct(usable, n_expected)}  (found and auto_approved/approved)")
    print(f"precision strict:  {pct(strict_ok, n_built)}")
    print(f"precision lenient: {pct(lenient_ok, n_built)}  (borderline extras allowed)")
    print(f"auto-approval:     {pct(auto, n_built)}")
    print(f"needs agree:       {pct(needs_ok, found)}")
    for label, rows in (("misses", misses), ("extras", extras), ("duplicates", duplicates)):
        if rows:
            print(f"{label}:")
            for r in rows:
                print(f"  - {r}")

    out_dir = DATA_DIR / "results"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"checklist_{args.label}_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.write_text(json.dumps({
        "label": args.label, "llm": llm, "built": n_built, "expected": n_expected,
        "recall": found / n_expected if n_expected else None,
        "usable_recall": usable / n_expected if n_expected else None,
        "precision_strict": strict_ok / n_built if n_built else None,
        "precision_lenient": lenient_ok / n_built if n_built else None,
        "auto_approval": auto / n_built if n_built else None,
        "needs_agree": needs_ok / found if found else None,
        "misses": misses, "extras": extras, "duplicates": duplicates,
        "requirements": built,
    }, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"saved {out.relative_to(DATA_DIR.parents[1])}")


if __name__ == "__main__":
    main()
