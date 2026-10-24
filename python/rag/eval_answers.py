"""
Answer eval: run the full contract check (search + llm + code verification) on each ground-truth question.

    cd python
    venv\\Scripts\\python.exe -B -m rag.eval_answers --label baseline

Three scores per run:
  verdict accuracy   llm verdict == expected verdict
  exact outcome      final status is exactly right (compliant->pass, violation->violation, not_covered->review)
  safe routing       nothing wrong gets paid: compliant->pass, anything else -> human (violation or review)
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from rag.contract_check import check_line, check_payment_terms
from rag.embeddings import model_name

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "eval"
THRESHOLDS = {"min_confidence": 0.80, "min_similarity": 0.50}
EXACT = {"compliant": "pass", "violation": "violation", "not_covered": "review"}


def run_question(org, q):
    invoice = q["invoice"]
    if q["check"] == "payment_terms":
        return check_payment_terms(org, q["vendor_id"], invoice, True, THRESHOLDS)
    # same convention as the retrieval eval: price -> first line, extra charge -> last line
    item = invoice["line_items"][0] if q["check"] == "unit_price" else invoice["line_items"][-1]
    return check_line(org, q["vendor_id"], invoice, item, True, THRESHOLDS)


def main():
    parser = argparse.ArgumentParser(description="score the full contract check against data/eval/questions.json")
    parser.add_argument("--label", default="run")
    parser.add_argument("--pause", type=float, default=6, help="seconds between questions (free-tier rate limit)")
    args = parser.parse_args()

    spec = json.loads((DATA_DIR / "questions.json").read_text(encoding="utf-8"))
    org = spec["organization_id"]
    rows = []
    verdict_ok = exact_ok = safe_ok = errors = 0

    for i, q in enumerate(spec["questions"]):
        if i:
            time.sleep(args.pause)
        expected = q["expected"]["verdict"]
        r = run_question(org, q)
        # an api outage after all retries is not a wrong answer - count it separately
        if any(p.startswith("check failed:") for p in r["problems"]):
            errors += 1
            rows.append({"id": q["id"], "expected": expected, "error": r["problems"][0], "result": r})
            print(f"  Q{q['id']:>2} ERR  {r['problems'][0][:120]}")
            continue
        v_ok = r["verdict"] == expected
        e_ok = r["status"] == EXACT[expected]
        s_ok = (r["status"] == "pass") == (expected == "compliant")
        verdict_ok += v_ok
        exact_ok += e_ok
        safe_ok += s_ok
        rows.append({"id": q["id"], "expected": expected, "verdict_ok": v_ok, "exact_ok": e_ok,
                     "safe_ok": s_ok, "result": r})
        flag = "OK  " if e_ok else ("SAFE" if s_ok else "BAD ")
        problems = f"  problems: {'; '.join(r['problems'])}" if r["problems"] else ""
        print(f"  Q{q['id']:>2} {flag} expected={expected:<11} llm={str(r['verdict']):<11} "
              f"status={r['status']:<9} {r['section'] or '-':<22} conf={r['llm_confidence']}{problems}")

    n = len(spec["questions"]) - errors
    if n == 0:
        sys.exit("every question failed with an api error - nothing to score")
    llm = f"{os.getenv('LLM_PROVIDER', 'gemini')}:{os.getenv('GEMINI_MODEL', 'gemini-3.8-flash')}"
    print(f"\n[{llm} | {model_name()}]  scored {n} questions, {errors} api errors excluded")
    print(f"verdict accuracy: {verdict_ok}/{n} = {verdict_ok / n:.0%}")
    print(f"exact outcome:    {exact_ok}/{n} = {exact_ok / n:.0%}")
    print(f"safe routing:     {safe_ok}/{n} = {safe_ok / n:.0%}")

    out_dir = DATA_DIR / "results"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"answers_{args.label}_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.write_text(json.dumps({
        "label": args.label, "llm": llm, "embed_model": model_name(), "thresholds": THRESHOLDS,
        "scored": n, "api_errors": errors,
        "verdict_accuracy": verdict_ok / n, "exact_outcome": exact_ok / n, "safe_routing": safe_ok / n,
        "questions": rows,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"saved {out.relative_to(DATA_DIR.parents[1])}")


if __name__ == "__main__":
    main()
