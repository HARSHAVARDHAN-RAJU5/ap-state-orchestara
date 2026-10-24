"""
Requirement-check eval: run rag.requirements.check_requirements on the sample invoices in
data/eval/requirement_questions.json, against the APPROVED checklist in the DB (auto_approved / approved).

    cd python
    venv\\Scripts\\python.exe -B -m rag.eval_requirements --label baseline

Scores:
  accuracy        status is one of the expected statuses
  safe routing    nothing that should reach a human (expected only violation / review) came back pass / skipped
  invoice routing invoice goes to a human exactly when it should (extra checklist items included)
  api errors      calls that failed after all retries - counted separately, not as wrong answers
  not in checklist expected requirements the approved checklist doesn't have (nobody checks them)
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from rag.eval_checklist import match_keys
from rag.requirements import check_one, load_requirements

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "eval"
THRESHOLDS = {"min_confidence": 0.80}
HUMAN = {"violation", "review"}


def main():
    parser = argparse.ArgumentParser(description="score the requirement check against requirement_questions.json")
    parser.add_argument("--label", default="run")
    parser.add_argument("--pause", type=float, default=5, help="seconds between ai calls (free-tier rate limit)")
    parser.add_argument("--only", type=int, nargs="*", help="invoice ids to run (default: all)")
    parser.add_argument("--file", default="requirement_questions.json", help="test set in data/eval/")
    args = parser.parse_args()

    spec = json.loads((DATA_DIR / args.file).read_text(encoding="utf-8"))
    org = spec["organization_id"]
    checklists = {}

    scored = correct = safe_n = safe_ok = errors = 0
    route_ok = route_n = 0
    missing, wrong, rows = [], [], []
    first_call = True

    for inv in spec["invoices"]:
        if args.only and inv["id"] not in args.only:
            continue
        vendor = inv["vendor_id"]
        if vendor not in checklists:
            checklists[vendor] = load_requirements(org, vendor)
        reqs = checklists[vendor]
        keys = [{"key": k, **v} for k, v in spec["keys"][vendor].items()]

        print(f"\n#{inv['id']} {inv['title']} ({vendor}, {len(reqs)} approved requirements)")
        results, covered, api_error = [], set(), False
        for req in reqs:
            if req["needs"] == "invoice_text":
                if not first_call:
                    time.sleep(args.pause)
                first_call = False
            r = check_one(req, inv["raw_text"], THRESHOLDS)
            matched = [e["key"] for e in match_keys(req, keys)]
            r["matched"] = matched
            results.append(r)
            line = (f"  {r['status']:<9} {r['section']:<10} {req['requirement'][:70]:<70} "
                    f"llm={r['verdict']} conf={r['llm_confidence']}")

            if any(p.startswith("check failed:") for p in r["problems"]):
                errors += 1
                api_error = True
                print(f"  ERR       {r['section']:<10} {r['problems'][0][:140]}")
                continue

            if not matched:
                print(line + "  [extra]" + (f"  - {'; '.join(r['problems'])}" if r["problems"] else ""))
                continue
            for k in matched:
                covered.add(k)
                expected = inv["expected"].get(k)
                if not expected:
                    continue
                scored += 1
                ok = r["status"] in expected
                correct += ok
                if set(expected) <= HUMAN:
                    safe_n += 1
                    safe_ok += r["status"] in HUMAN
                tag = "OK " if ok else ("SAFE" if r["status"] in HUMAN or not set(expected) <= HUMAN else "BAD")
                print(f"{line}  {tag} {k} expected={expected}"
                      + (f"  - {'; '.join(r['problems'])}" if r["problems"] else "")
                      + (f"  | {r['explanation']}" if not ok and r["explanation"] else ""))
                if not ok:
                    wrong.append({"invoice": inv["id"], "key": k, "expected": expected, "got": r["status"],
                                  "llm": r["verdict"], "problems": r["problems"], "explanation": r["explanation"],
                                  "evidence": r["evidence"]})

        for k in inv["expected"]:
            if k not in covered and not api_error:
                missing.append(f"#{inv['id']} {vendor} {k}")
                print(f"  MISSING   {k} not in the approved checklist (expected {inv['expected'][k]})")

        if not api_error:
            should_human = any(set(v) <= HUMAN for v in inv["expected"].values())
            goes_human = any(r["status"] in HUMAN for r in results)
            route_n += 1
            route_ok += should_human == goes_human
            print(f"  routing: {'human' if goes_human else 'auto'} "
                  f"(expected {'human' if should_human else 'auto'})")
        rows.append({"id": inv["id"], "vendor_id": vendor, "title": inv["title"],
                     "expected": inv["expected"], "results": results})

    if scored == 0:
        sys.exit("nothing scored (api errors or empty checklist)")
    llm = f"{os.getenv('LLM_PROVIDER', 'gemini')}:{os.getenv('GEMINI_MODEL', 'gemini-3.8-flash')}"
    print(f"\n[{llm}]  {scored} requirement checks scored, {errors} api errors excluded")
    print(f"accuracy:          {correct}/{scored} = {correct / scored:.0%}")
    print(f"safe routing:      {safe_ok}/{safe_n} = {safe_ok / safe_n:.0%}" if safe_n else "safe routing: n/a")
    print(f"invoice routing:   {route_ok}/{route_n} = {route_ok / route_n:.0%}" if route_n else "")
    print(f"not in checklist:  {len(missing)}" + (f" {missing}" if missing else ""))

    out_dir = DATA_DIR / "results"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"requirements_{args.label}_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.write_text(json.dumps({
        "label": args.label, "llm": llm, "thresholds": THRESHOLDS,
        "scored": scored, "api_errors": errors,
        "accuracy": correct / scored, "safe_routing": safe_ok / safe_n if safe_n else None,
        "invoice_routing": route_ok / route_n if route_n else None,
        "not_in_checklist": missing, "wrong": wrong, "invoices": rows,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"saved {out.relative_to(DATA_DIR.parents[1])}")


if __name__ == "__main__":
    main()
