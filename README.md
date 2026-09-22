# Orchestara — LangGraph Migration Branch

> **Branch**: `updated_version`  
> **Status**: Active migration — Python + LangGraph orchestration engine replacing the Node.js orchestrator.  
> For the original fully-Node.js pipeline see the `main` branch.

---

## What This Branch Is

This branch migrates the Orchestara orchestration engine from Node.js to Python + LangGraph.

The Node.js side (Express API, file upload, human decision endpoints, Redis event emission) stays. Everything from invoice processing onwards — PDF parsing, LLM extraction, all workers, state routing — runs in Python.

Node.js handles intake and human decisions. Python picks up every event from Redis and runs the pipeline.

### Current status
- ✅ Full pipeline: upload → extraction → checks → payment scheduling → approval → accounting → payment → `COMPLETED`
- ✅ Human decisions (payment approval, exception review) picked up by Python workers
- ✅ Every state transition written to `audit_event_log`
- ⏳ Not yet ported from `main`: exception auto-resolve, vendor notifications, retry-limit circuit breaker (see [Pending](#whats-still-pending-in-this-branch))

---

## What Changed From `main`

| Layer | `main` branch | `updated_version` branch |
|---|---|---|
| API + File Upload | Node.js + Express | Node.js + Express (unchanged) |
| PDF Parsing + LLM Extraction | Node.js (pdfjs + Ollama) | Python (pdfplumber + Ollama) |
| Orchestrator | `orchestrator.js` while loop | `python/orchestrator.py` + LangGraph graph |
| Workers | JavaScript (`workers/`) | Python (`python/workers/`) |
| Policy Engine | `core/PolicyEngine.js` | `python/policy_engine.py` |
| State Definition | Implicit JS objects | `TypedDict` via `graph/state.py` |
| Agent Layer | `agent/` folder (JS) | Removed — nodes call workers directly |

`orchestrator.js`, `workers/` and `agent/` do not exist on this branch.

---

## Project Structure

```
ap-state-orchestara/
├── app.js                          Express server — mounts all routes
├── db.js                           Node.js PostgreSQL pool (reads .env)
├── redisClient.js                  Shared Redis client
├── emit.js                         Manual test: push one event to Redis
├── dashborad.html                  Static dashboard — open directly in a browser
├── .env.example                    Environment template (copy to .env and python/.env)
├── CLAUDE.md                       Instructions for Claude Code + self-learning loop
│
├── db/schema.sql                   Full database schema (pg_dump --schema-only)
├── test/                           Sample invoice PDF + approval payload
│
├── routes/
│   ├── ApprovalRoutes.js           Payment approval decision (PENDING_APPROVAL)
│   ├── exceptionReviewRoutes.js    Exception review decision (EXCEPTION_REVIEW)
│   ├── paymentRoutes.js            Manual payment trigger
│   └── recovery.routes.js          Vendor file resubmission (WAITING_INFO → RECEIVED)
│
├── modules/step1-intake/
│   ├── routes/invoiceIntake.js     Upload endpoints (/upload, /email, /api)
│   ├── services/intakeService.js   Saves file, creates invoice record, emits Redis event
│   └── storage/invoices/           Uploaded PDFs (git-ignored)
│
├── core/                           Node-era services not yet ported to Python
│   ├── ReflectionService.js        Circuit breaker for repeatedly failing invoices
│   ├── workerIdempotency.js        Worker completion tracking
│   ├── AgentLogger.js              agent_action_log writer
│   ├── PolicyEngine.js             Node version of the policy engine
│   └── taxEngineCompliance.js
│
├── monitoring/
│   └── sla_monitor.js              SLA enforcement background worker
│
└── python/                         Python orchestration engine
    ├── orchestrator.py             Redis listener + LangGraph runner + audit writer
    ├── db.py                       PostgreSQL connection (reads python/.env)
    ├── policy_engine.py            Loads org config from DB
    ├── requirements.txt            Pinned Python dependencies
    │
    ├── graph/
    │   ├── state.py                InvoiceState TypedDict
    │   ├── nodes.py                LangGraph nodes — call workers
    │   └── builder.py              Graph construction + routing logic
    │
    └── workers/
        ├── intake_worker.py            PDF parsing (pdfplumber) + LLM extraction (Ollama)
        ├── duplicate_worker.py         Paid registry + pipeline duplicate check
        ├── validation_worker.py        Vendor, bank account, tax ID validation
        ├── matching_worker.py          PO matching with fuzzy vendor name + tolerance
        ├── fraud_worker.py             6-signal fraud scoring
        ├── compliance_worker.py        GST math + high value flag
        ├── payment_worker.py           Payment scheduling + approval tier assignment
        ├── pending_approval_worker.py  Applies the approver's APPROVE / REJECT
        ├── exception_review_worker.py  Applies the reviewer's APPROVE / ESCALATE / BLOCK
        └── accounting_worker.py        Double-entry journals + payment execution + paid registry
```

---

## How The Pipeline Works

```
PDF Upload → Node.js (intakeService.js)
  saves file to disk
  inserts into invoices table
  sets invoice_state_machine.current_state = RECEIVED
  emits event to Redis Stream (invoice_events)
         |
orchestrator.py (Redis listener)
  reads current_state from PostgreSQL
  loads org config via policy_engine.py
  calls graph.invoke(initial_state)
         |
LangGraph Graph (builder.py)
  ROUTER node → jumps to the node for current_state
  each node calls its Python worker
  worker returns next_state + reason
  graph continues until it reaches a stop state:
    PENDING_APPROVAL, EXCEPTION_REVIEW, WAITING_INFO, COMPLETED, BLOCKED
  (or a worker makes no progress / returns an error)
         |
orchestrator.py
  writes one audit_event_log row per transition
  updates invoice_state_machine to the final state
  acks the Redis message
```

Human decision endpoints record the decision and re-emit the event. On the next run, the
`PENDING_APPROVAL` / `EXCEPTION_REVIEW` worker reads the decision and moves the invoice on.

---

## State Machine

```
RECEIVED → STRUCTURED → DUPLICATE_CHECK → VALIDATING → MATCHING
→ FRAUD_SCREENING → COMPLIANCE → PAYMENT_READY → PENDING_APPROVAL
→ ACCOUNTING → COMPLETED

Human decisions:
PENDING_APPROVAL  --APPROVE--> ACCOUNTING
PENDING_APPROVAL  --REJECT---> EXCEPTION_REVIEW
EXCEPTION_REVIEW  --APPROVE--> PAYMENT_READY   (fresh approval — never straight to paid)
EXCEPTION_REVIEW  --ESCALATE-> EXCEPTION_REVIEW (new review cycle)
EXCEPTION_REVIEW  --BLOCK----> BLOCKED

Other paths:
ACCOUNTING   waits until the payment due date (SLA monitor re-triggers it), then pays → COMPLETED
WAITING_INFO → RECEIVED (vendor resubmission)
BLOCKED, COMPLETED → terminal
```

---

## Fraud Detection — 6 Signals

| Signal | Score | What It Detects |
|---|---|---|
| ROUND_AMOUNT | +15 | Amount divisible by 1000 |
| FIRST_TIME_VENDOR | +20 | No previous invoices from this vendor |
| RAPID_RESUBMISSION | +25 | Same vendor 2+ invoices in last 24 hours |
| BACKDATED_INVOICE | +20 | Invoice date more than 30 days ago |
| AMOUNT_SPIKE | +25 | Amount exceeds 2.5x vendor historical average |
| PO_REUSE | +30 | Same PO number on multiple invoices |

Score < 30 → COMPLIANCE  
Score 30–60 → EXCEPTION_REVIEW  
Score > 60 → BLOCKED

---

## Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- PostgreSQL on port 5433, database `ap_orchestara` (create tables with `db/schema.sql`)
- Redis on 6379 (Docker)
- Ollama with the `llama3` model

### Environment variables
Copy `.env.example` to **both** `.env` (repo root, for Node) and `python/.env` (for Python), then set `DB_PASSWORD`.
Both files are git-ignored — never commit real credentials.

```
DB_HOST=localhost
DB_PORT=5433
DB_NAME=ap_orchestara
DB_USER=postgres
DB_PASSWORD=your_password
REDIS_URL=redis://127.0.0.1:6379
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3
BANK_ACCOUNT_ID=3001
```

### Node.js
```bash
npm ci
```

### Python
```bash
cd python
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux
pip install -r requirements.txt
```

---

## Running The System

```bash
# Terminal 1 — Node.js API (upload + decision endpoints)
node app.js

# Terminal 2 — Python LangGraph orchestrator
cd python
venv\Scripts\activate
python orchestrator.py

# Terminal 3 — SLA monitor
node monitoring/sla_monitor.js
```

Dashboard: open `dashborad.html` in a browser while the API is running.

---

## Test Invoice Upload

Run from the repo root (PowerShell):

```powershell
# 1. Upload invoice
curl.exe -X POST http://localhost:3000/api/invoices/intake/upload `
  -F "file=@test/INV-1001-TEST.pdf" `
  -F "organization_id=ORG-1"

# 2a. Invoice reached PENDING_APPROVAL — payment approval (APPROVE or REJECT)
#     reviewer_role must match the invoice's required approval level
curl.exe -X POST http://localhost:3000/api/approvals/INVOICE_ID/decision `
  -H "Content-Type: application/json" `
  -d "{\"decision\":\"APPROVE\",\"reviewer_role\":\"VP_FINANCE\",\"reviewer_name\":\"Test Approver\",\"comment\":\"Approved\"}"

# 2b. Invoice reached EXCEPTION_REVIEW — review decision (APPROVE, ESCALATE or BLOCK)
curl.exe -X POST http://localhost:3000/api/review/INVOICE_ID/decision `
  -H "Content-Type: application/json" `
  -d "{\"decision\":\"APPROVE\",\"reviewer_role\":\"VP_FINANCE\",\"reviewer_name\":\"Test Reviewer\",\"comment\":\"Checked with vendor\"}"
```

Check progress:
```sql
SELECT current_state, error_reason FROM invoice_state_machine WHERE invoice_id = 'INVOICE_ID';
SELECT old_state, new_state, reason, created_at FROM audit_event_log WHERE invoice_id = 'INVOICE_ID' ORDER BY created_at;
```

---

## Clean Test Run (Truncate Transaction Tables)

Clears invoice data only — config and master tables (vendors, POs, approval config, tax rules) are kept.

```sql
TRUNCATE TABLE audit_event_log CASCADE;
TRUNCATE TABLE agent_action_log CASCADE;
TRUNCATE TABLE agent_reflection_log CASCADE;
TRUNCATE TABLE invoice_state_machine CASCADE;
TRUNCATE TABLE invoice_extracted_data CASCADE;
TRUNCATE TABLE invoice_validation_results CASCADE;
TRUNCATE TABLE invoice_po_matching_results CASCADE;
TRUNCATE TABLE invoice_payment_schedule CASCADE;
TRUNCATE TABLE invoice_approval_workflow CASCADE;
TRUNCATE TABLE invoice_payment_approvals CASCADE;
TRUNCATE TABLE exception_review_decisions CASCADE;
TRUNCATE TABLE journal_entries CASCADE;
TRUNCATE TABLE journal_lines CASCADE;
TRUNCATE TABLE paid_invoice_registry CASCADE;
TRUNCATE TABLE invoice_fraud_scores CASCADE;
TRUNCATE TABLE invoice_compliance_results CASCADE;
TRUNCATE TABLE invoice_risk_assessment CASCADE;
TRUNCATE TABLE failure_patterns CASCADE;
TRUNCATE TABLE worker_completion_log CASCADE;
TRUNCATE TABLE invoices CASCADE;
```

---

## What's Still Pending In This Branch

- [x] PendingApprovalWorker and ExceptionReviewWorker in Python (human decisions)
- [ ] Exception auto-resolve by fraud score + SLA escalation (from `main`'s ExceptionReviewAgent)
- [ ] Wire NotificationWorker in Python (vendor emails via Resend)
- [ ] Python equivalent of ReflectionService circuit breaker (retry limit → EXCEPTION_REVIEW)
- [ ] Python equivalent of workerIdempotency
- [ ] Pydantic structured outputs for LLM calls
- [ ] Swap Ollama to OpenAI API

---

## Why LangGraph

The Node.js orchestrator was a manual graph — a while loop that read state, picked an agent, ran it, and routed to the next. LangGraph replaces that with a proper graph framework that gives:

- Node-level crash recovery and state persistence
- Real-time streaming of graph execution
- Clean human-in-the-loop pause points
- Visual graph representation

The architecture principle stays the same: LLMs are workers, not decision makers. State machine controls all routing. Every transition is auditable.

---

## Branches

| Branch | Purpose |
|---|---|
| `main` | Original fully Node.js pipeline |
| `updated_version` | This branch — Python + LangGraph migration |
| `clg-project` | Clean college presentation version |

---

*Author: Harshavardhan R — AI Systems Engineering 2026*
