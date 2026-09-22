# CLAUDE.md — Orchestara (AP invoice orchestration)

Accounts-payable pipeline: an invoice PDF is uploaded → extracted by an LLM → pushed through a
deterministic state machine (duplicate → validation → PO matching → fraud → compliance → payment
→ approval → accounting). **LLMs are workers, not decision makers**: routing is decided only by
worker return values and the state machine, and every transition must be auditable.

Branch `updated_version` = migration of the orchestrator from Node.js to **Python + LangGraph**.
`main` holds the old fully-Node pipeline. Don't port changes between branches unless asked.

## Architecture (two runtimes, one Postgres, one Redis stream)

| Runtime | Owns | Entry |
|---|---|---|
| Node.js (ESM, Express 5) | HTTP API, file upload, human decisions, SLA monitor | `app.js`, `monitoring/sla_monitor.js` |
| Python 3.11 (LangGraph 1.1) | Extraction + all workers + routing | `python/orchestrator.py` |

Hand-off: Node writes `invoice_state_machine.current_state` then `XADD invoice_events {invoice_id, organization_id}`.
`orchestrator.py` consumes group `python_orchestrator`, reads state from DB, runs `graph.invoke()`,
then writes one `audit_event_log` row **per hop** (from `state["history"]`) and the final state. The DB is
only written after the run — never rely on `invoice_state_machine.current_state` inside a worker.
Messages are always acked, even on failure.

- `python/graph/builder.py` — `ROUTER` runs the node for the invoice's current state. Every node is wrapped by `step()`, which stamps `current_state` and appends the hop to `history`. `route()` ends the run when `next_state` is None (error), equals the current node (no progress, e.g. payment not due), or is in `STOP_STATES` (PENDING_APPROVAL, EXCEPTION_REVIEW, WAITING_INFO, COMPLETED, BLOCKED). Never let a node route to itself without this check — it recurses until `GraphRecursionError`.
- Pause states are nodes too: when a human decision re-emits the event, `pending_approval_worker` / `exception_review_worker` atomically claim the decision (`UPDATE ... SET processed = true ... RETURNING`) and move on.
- `review_cycle` is bumped by the orchestrator on every hop into EXCEPTION_REVIEW, and by `exception_review_worker` on ESCALATE. Decisions are matched to the current cycle.
- `python/graph/state.py` — `InvoiceState` TypedDict. Add new keys here before using them.
- `python/workers/*.py` — one `run(state) -> dict` per state.
- `python/policy_engine.py` — per-org config (approval tiers, match tolerance, payment policy).
- `routes/*.js` — human-in-the-loop endpoints (approval, exception review, manual pay, vendor resubmission); each updates DB then re-emits to Redis.
- `core/*.js` — `ReflectionService` (circuit breaker), `workerIdempotency`, `AgentLogger`: Node-era services **not yet ported** to Python.
- `db/schema.sql` — `pg_dump --schema-only --no-owner` of the live DB (regenerate after schema changes; `pg_dump` is in `C:\Program Files\PostgreSQL\15\bin`). `test/schema1.sql` is an older copy.
- `dashborad.html` — static dashboard (filename typo is intentional/legacy; don't rename, links depend on it).

## State machine
```
RECEIVED → STRUCTURED → DUPLICATE_CHECK → VALIDATING → MATCHING → FRAUD_SCREENING
→ COMPLIANCE → PAYMENT_READY → PENDING_APPROVAL → ACCOUNTING → COMPLETED
Pause (human/external): PENDING_APPROVAL, EXCEPTION_REVIEW, WAITING_INFO
Terminal: COMPLETED, BLOCKED
EXCEPTION_REVIEW --approve--> PAYMENT_READY (never straight to approved/paid)
WAITING_INFO --vendor resubmits--> RECEIVED
```

## Worker contract (follow exactly when adding/editing a worker)
- Signature `run(state: dict) -> dict`; return `{**state, "next_state": <STATE|None>, "reason": <str>}`.
- `next_state=None` means "stop, no transition" — used for errors; orchestrator won't update the state.
- `reason` is written to the audit log — make it specific and human-readable (include numbers).
- Read inputs from DB (`invoice_extracted_data.data` JSONB), not from graph state; state only carries ids + `config`.
- Writes use `INSERT ... ON CONFLICT (invoice_id, organization_id) DO UPDATE` so reruns are idempotent.
- Always parameterized SQL (`%s`), every query scoped by `organization_id` (multi-tenant).
- Money: `float(... or 0)`, 1-unit rounding tolerance for tax/total math. Fraud thresholds: <30 pass, 30–60 review, >60 block.
- Register new workers in `graph/nodes.py` **and** `graph/builder.py` (node + conditional edge list).

## Running
```bash
npm ci                                        # once
node app.js                                   # API on :3000
cd python && venv\Scripts\activate && python orchestrator.py
node monitoring/sla_monitor.js
```
Needs Postgres on **5433** db `ap_orchestara`, Redis on 6379, Ollama `llama3` on 11434.
Config lives in `.env` (Node, repo root) and `python/.env` — both git-ignored, template in `.env.example`.
Python deps are pinned in `python/requirements.txt`; the venv is **not** in git.
There is no automated test suite (`npm test` is a stub). Verify by uploading `test/INV-1001-TEST.pdf`
(see README curl commands) and checking `invoice_state_machine` + `audit_event_log`.
For graph-routing changes, test the real `build_graph()` with the node functions in `graph.nodes` monkeypatched to scripted stubs (patch before importing/reloading `graph.builder`) — no DB needed. Run Python with `-B` so no `.pyc` files are written.

## Known gaps (as of 2026-09-22 — fix only when asked)
- No retry limit: a graph exception just bumps `retry_count` forever (Node `ReflectionService` circuit breaker not ported).
- Exception auto-resolve by fraud score / SLA escalation from `main`'s ExceptionReviewAgent not ported — EXCEPTION_REVIEW waits for a human.
- The DB password was committed in git history before 2026-09-22 (removed from code since). Never put secrets in code; use `.env`.
- Uploaded PDFs go to `modules/step1-intake/storage/invoices/` (git-ignored) — don't commit them.

## Conventions
- Node: ESM `import`, `pool` from `db.js`, Redis via `redisClient.js` (node-redis `xAdd`). `emit.js` uses ioredis — legacy test script.
- Python: modules import siblings as top-level (`from db import ...`) because `orchestrator.py` puts `python/` on `sys.path`. Run from `python/`.
- Open/close a connection per query is the current style; match it unless refactoring on request.
- Keep comments short, lower-case, explaining *why* — match surrounding files.
- Git: work on `updated_version`; commit only when asked.

## Self-learning loop
This project keeps a running log of lessons learned in `.claude/LEARNINGS.md`, imported below so
it loads every session. Treat it as your experience from earlier sessions.

**1. Recall** — before starting, scan the lessons for the area you're touching (tagged `[python]`, `[node]`, `[db]`, `[graph]`, `[env]`, `[workflow]`).
**2. Act** — do the task. Pay attention to surprises: a failed command, a wrong assumption, a user correction, a bug you tracked down, a slow path you later found a shortcut for.
**3. Reflect** — before your final message on any non-trivial task, ask: *"What do I know now that I wish I'd known at the start?"* If the answer is non-obvious and reusable, append an entry (format in the file). Skip it if nothing new was learned; no filler entries.
**4. Consolidate** — when a lesson has been hit 2+ times (bump its `seen` count instead of duplicating), promote it into a rule in the relevant section of this CLAUDE.md and delete it from the log. If a lesson turns out wrong or the code changed, fix or remove it.
**5. Close the loop** — mention in your final message, in one line, any lesson you added/promoted.

Run `/learn` to do an explicit reflect + consolidate pass. User corrections always become a lesson.

@.claude/LEARNINGS.md
