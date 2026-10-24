"""
Retrieval eval: for each ground-truth question, is a correct section in the top 3?

    cd python
    venv\\Scripts\\python.exe -B -m rag.eval_retrieval --label baseline
"""
import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from rag.embeddings import model_name
from rag.retrieve import build_query, search

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "eval"
K = 3


def section_number(section_title):
    # "4. Payment Terms" -> "4"
    return section_title.split(".")[0].strip()


def is_gold(result, gold):
    if section_number(result["section_title"]) != gold["section"]:
        return False
    if gold.get("vendor_id"):
        return result["vendor_id"] == gold["vendor_id"]
    # org-wide policy: matched by document name
    return result["vendor_id"] is None and gold["doc"].lower() in result["doc_name"].lower()


def main():
    parser = argparse.ArgumentParser(description="score retrieval against data/eval/questions.json")
    parser.add_argument("--label", default="run", help="name for this run, e.g. baseline / hybrid")
    args = parser.parse_args()

    spec = json.loads((DATA_DIR / "questions.json").read_text(encoding="utf-8"))
    org = spec["organization_id"]

    rows, hits, scored, rr_sum = [], 0, 0, 0.0
    by_check = defaultdict(lambda: [0, 0])

    for q in spec["questions"]:
        query = build_query(q["check"], q["invoice"])
        results = search(org, q["vendor_id"], query, k=K)
        got = [f"{r['vendor_id'] or 'POLICY'} §{section_number(r['section_title'])} ({r['similarity']:.2f})"
               for r in results]

        if not q["gold_sections"]:
            rows.append({"id": q["id"], "status": "skip", "query": query, "top3": got})
            print(f"  Q{q['id']:>2} SKIP  (no gold section)  top3: {', '.join(got)}")
            continue

        rank = next((i + 1 for i, r in enumerate(results) if any(is_gold(r, g) for g in q["gold_sections"])), None)
        hit = rank is not None
        scored += 1
        hits += hit
        rr_sum += 1 / rank if hit else 0
        by_check[q["check"]][0] += hit
        by_check[q["check"]][1] += 1

        rows.append({"id": q["id"], "status": "hit" if hit else "miss", "rank": rank, "query": query, "top3": got})
        print(f"  Q{q['id']:>2} {'HIT ' if hit else 'MISS'}  rank={rank or '-'}  top3: {', '.join(got)}")

    hit_rate = hits / scored if scored else 0
    mrr = rr_sum / scored if scored else 0
    print(f"\n[{model_name()}] hit rate @{K}: {hits}/{scored} = {hit_rate:.0%}   MRR: {mrr:.2f}")
    for check, (h, n) in by_check.items():
        print(f"  {check:<14} {h}/{n}")

    out_dir = DATA_DIR / "results"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"retrieval_{args.label}_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.write_text(json.dumps({
        "label": args.label, "embed_model": model_name(), "k": K, "hit_rate": hit_rate, "mrr": mrr,
        "hits": hits, "scored": scored,
        "by_check": {c: {"hits": h, "total": n} for c, (h, n) in by_check.items()},
        "questions": rows,
    }, indent=2), encoding="utf-8")
    print(f"saved {out.relative_to(DATA_DIR.parents[1])}")


if __name__ == "__main__":
    main()
