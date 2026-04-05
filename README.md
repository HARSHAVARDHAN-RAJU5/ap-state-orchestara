# Orchestara — LangGraph Migration Branch

> **Branch**: `updated_version`  
> **Status**: Active migration — Python + LangGraph orchestration engine replacing Node.js orchestrator.  
> For the stable, fully working Node.js pipeline see the `main` branch.

---

## What This Branch Is

This branch migrates the Orchestara orchestration engine from Node.js to Python + LangGraph.

The Node.js side (Express API, file upload, Redis event emission) stays unchanged. Everything from invoice processing onwards — PDF parsing, LLM extraction, all workers, state routing — moves to Python.

Both orchestrators can run simultaneously during migration. Node.js handles intake. Python picks up from Redis and runs the full pipeline.

---

## What Changed From `main`

| Layer | `main` branch | `updated_version` branch |
|---|---|---|
| API + File Upload | Node.js + Express | Node.js + Express (unchanged) |
| PDF Parsing + LLM Extraction | Node.js (pdfjs + Ollama) | Python (pdfplumber + Ollama) |
| Orchestrator | `orchestrator.js` while loop | `orchestrator.py` + LangGraph graph |
| Workers | JavaScript (`workers/`) | Python (`python/workers/`) |
| Policy Engine | `core/PolicyEngine.js` | `python/policy_engine.py` |
| State Definition | Implicit JS objects | `TypedDict` via `graph/state.py` |
| Agent Layer | `agent/` folder (JS) | Removed — nodes call workers directly |

---

## Project Structure

```
orchestara/
├── app.js                          Express server — file upload + Redis emit
├── redisClient.js                  Shared Redis singleton
├── db.js                           Node.js PostgreSQL connection
├── dashborad.html                  Static dashboard (opens in browser)
│
├── routes/
│   ├── ApprovalRoutes.js           Human approval decision endpoint
│   ├── exceptionReviewRoutes.js    Exception review decision endpoint
│   ├── paymentRoutes.js            Manual payment trigger
│   └── recovery.routes.js          Vendor file resubmission
│
├── modules/
│   └── step1-intake/
│       ├── routes/invoiceIntake.js File upload endpoints
│       └── services/intakeService.js Saves file, creates invoice record, emits Redis event
│
├── monitoring/
│   └── sla_monitor.js              SLA enforcement background worker
│
├── recovery_uploads/               Vendor resubmitted files land here
│
└── python/                         Python orchestration engine
    ├── orchestrator.py             Redis listener + LangGraph graph runner
    ├── db.py                       PostgreSQL connection (psycopg2)
    ├── policy_engine.py            Loads org config from DB
    │
    ├── graph/
    │   ├── __init__.py
    │   ├── state.py                InvoiceState TypedDict
    │   ├── nodes.py                LangGraph nodes — call workers
    │   └── builder.py              Graph construction + routing logic
    │
    └── workers/
        ├── __init__.py
        ├── intake_worker.py        PDF parsing (pdfplumber) + LLM extraction (Ollama)
        ├── duplicate_worker.py     Paid registry + pipeline duplicate check
        ├── validation_worker.py    Vendor, bank account, tax ID validation
        ├── matching_worker.py      PO matching with fuzzy vendor name + tolerance
        ├── fraud_worker.py         6-signal fraud scoring
        ├── compliance_worker.py    GST math + high value flag
        ├── payment_worker.py       Payment scheduling + approval tier assignment
        └── accounting_worker.py    Double-entry journal entries + payment execution
```

---

## How The Pipeline Works Now

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
  builds initial InvoiceState dict
  calls graph.invoke(initial_state)
         |
LangGraph Graph (builder.py)
  ROUTER node → jumps to correct node based on current_state
  each node calls the corresponding Python worker
  worker returns updated state with next_state + reason
  graph routes to next node via conditional edges
  stops at: PENDING_APPROVAL, EXCEPTION_REVIEW,
            WAITING_INFO, COMPLETED, BLOCKED
         |
orchestrator.py
  reads final state from graph result
  updates invoice_state_machine in PostgreSQL
  writes audit_event_log entry
  acks Redis message
```

---

## State Machine

```
RECEIVED → STRUCTURED → DUPLICATE_CHECK → VALIDATING → MATCHING
→ FRAUD_SCREENING → COMPLIANCE → PAYMENT_READY → PENDING_APPROVAL

Exception paths:
EXCEPTION_REVIEW → PAYMENT_READY (on human approve — never directly to APPROVED)
WAITING_INFO → RECEIVED (vendor resubmission)
BLOCKED → terminal
COMPLETED → terminal
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

## Setup — Python Side

### Prerequisites
- Python 3.11+
- PostgreSQL on port 5433, database: `ap_orchestara`
- Redis running (Docker)
- Ollama with llama3 model

### Create and activate venv
```bash
cd orchestara/python
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux
```

### Install packages
```bash
pip install langgraph langchain-openai psycopg2-binary redis python-dotenv pdfplumber rapidfuzz requests
```

### Environment variables
Create `.env` in the `python/` folder:
```
DB_HOST=localhost
DB_PORT=5433
DB_NAME=ap_orchestara
DB_USER=postgres
DB_PASSWORD=your_password
REDIS_URL=redis://127.0.0.1:6379
OLLAMA_URL=http://127.0.0.1:11434
BANK_ACCOUNT_ID=3001
```

---

## Running The System

```bash
# Terminal 1 — Node.js API (file upload + Redis emit only)
node app.js

# Terminal 2 — Python LangGraph orchestrator
cd python
venv\Scripts\activate
python orchestrator.py

# Terminal 3 — SLA Monitor (still Node.js)
node monitoring/sla_monitor.js
```

---

## Test Invoice Upload

```powershell
# Upload invoice
curl.exe -X POST http://localhost:3000/api/invoices/intake/upload `
  -F "file=@INV-1001-TEST.pdf" `
  -F "organization_id=ORG-1"

# Submit approval decision (once invoice reaches PENDING_APPROVAL or EXCEPTION_REVIEW)
curl.exe -X POST http://localhost:3000/api/review/INVOICE_ID/decision `
  -H "Content-Type: application/json" `
  -d "{\"decision\":\"APPROVE\",\"reviewer_role\":\"VP_FINANCE\",\"reviewer_name\":\"Test Approver\",\"comment\":\"Approved\"}"
```

---

## Clean Test Run (Truncate All Tables)

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
TRUNCATE TABLE exception_review_decisions CASCADE;
TRUNCATE TABLE journal_entries CASCADE;
TRUNCATE TABLE journal_lines CASCADE;
TRUNCATE TABLE paid_invoice_registry CASCADE;
TRUNCATE TABLE invoice_fraud_scores CASCADE;
TRUNCATE TABLE invoice_compliance_results CASCADE;
TRUNCATE TABLE worker_completion_log CASCADE;
TRUNCATE TABLE invoices CASCADE;
```

---

## What's Still Pending In This Branch

- [ ] Wire NotificationWorker in Python (vendor emails via Resend)
- [ ] Python equivalent of ReflectionService circuit breaker
- [ ] Python equivalent of workerIdempotency
- [ ] PendingApprovalWorker and ExceptionReviewWorker in Python
- [ ] Pydantic structured outputs for LLM calls
- [ ] Swap Ollama to OpenAI API
- [ ] Stop orchestrator.js completely once Python is fully stable

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
| `main` | Fully working Node.js pipeline — stable |
| `updated_version` | This branch — Python + LangGraph migration |
| `clg-project` | Clean college presentation version |

---

*Author: Harshavardhan R — AI Systems Engineering 2026*