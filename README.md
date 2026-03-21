# ORCHESTARA
### Autonomous Accounts Payable Orchestration Engine
> State-Driven Multi-Agent Financial Processing System

---

## Overview

Orchestara is a fully autonomous **Accounts Payable orchestration engine**. It processes invoices end-to-end without human intervention wherever possible. An invoice enters the system as a PDF, gets extracted by an LLM, validated against vendor master data, matched to purchase orders, fraud-scored, compliance-checked, scheduled for payment, approved, and finally journalized in accounting — all driven by a strict state machine.

**The key architectural principle: LLMs are workers, not decision makers.** The state machine controls all transitions. LLMs only classify and extract. Every transition is logged in an immutable audit trail.

Designed for fintech and enterprise AP teams who need to:
- Reduce manual invoice processing overhead
- Catch fraud and duplicate invoices automatically
- Maintain full auditability for SOC2 compliance
- Enforce multi-tier approval workflows dynamically

---

## Tech Stack

| Component | Technology | Details |
|---|---|---|
| Backend | Node.js + Express.js | REST API server on port 3000 |
| Database | PostgreSQL | Port 5433, database: ap_orchestara |
| Event Bus | Redis Streams | Docker container, port 6379 |
| AI / LLM | Llama3 via Ollama | Local inference at port 11434 |
| PDF Parsing | pdfjs-dist (legacy build) | Extracts text from uploaded invoices |
| Multi-tenancy | organization_id scoping | All tables scoped by organization |

---

## Architecture

### Core Design Principles

**Principle 1 — Deterministic Control**

The system strictly separates AI reasoning from financial execution. Agents perform analysis and classification. Workers perform state transitions and database mutations. This prevents LLM hallucinations from affecting financial records.

**Principle 2 — Audit-First Design**

Every state transition creates an immutable record in `audit_event_log`. Each record captures timestamp, previous state, new state, reason for transition, and reviewer identity for human decisions. This provides a SOC2-ready audit framework.

**Principle 3 — Multi-Tenant Policy Engine**

Organizations configure financial policies dynamically without code changes. Matching tolerance, approval thresholds, payment policies, and SLA rules are stored in organization-scoped configuration tables loaded per request via `PolicyEngine.js`.

---

### Three-Layer Architecture

```
ORCHESTRATOR (orchestrator.js)
  Reads current state from PostgreSQL
  Runs ReflectionService circuit breaker
  Calls SupervisorAgent.executeStep()
  Validates and commits state transition
  Writes audit log + emits next Redis event
         |
SUPERVISOR AGENT (SupervisorAgent.js)
  Selects correct agent based on current state
         |
AGENTS (IntakeExtractionAgent, ValidationAgent, etc.)
  plan() → act() → observe() → evaluate()
  Returns nextState decision
         |
WORKERS (IntakeExtractionWorker, ValidationWorker, etc.)
  Deterministic execution
  All DB reads and writes happen here
```

---

### Invoice Flow — End to End

```
PDF Upload (HTTP POST /api/invoices/intake/upload)
         |
intakeService.js
  saves PDF to disk
  creates invoices record
  sets invoice_state_machine.current_state = RECEIVED
  emits event to Redis Stream (invoice_events)
         |
orchestrator.js (while true Redis listener)
  reads current_state from PostgreSQL
  loads PolicyEngine config for org
  runs ReflectionService
  selects Agent via SupervisorAgent
  runs plan / act / evaluate cycle
  validates state transition via STATE_TRANSITIONS map
  writes new state + audit log
  emits next Redis event
         |
Repeats until: COMPLETED, BLOCKED,
WAITING_INFO, PENDING_APPROVAL, or EXCEPTION_REVIEW
```

---

### State Machine

```
RECEIVED → STRUCTURED → DUPLICATE_CHECK → VALIDATING → MATCHING
→ FRAUD_SCREENING → COMPLIANCE → PAYMENT_READY → PENDING_APPROVAL
→ EXCEPTION_REVIEW → APPROVED → ACCOUNTING → COMPLETED

Side paths:
WAITING_INFO → vendor email → waits for resubmission → RECEIVED
BLOCKED      → terminal failure state
```

| State | What Happens | Possible Next States |
|---|---|---|
| RECEIVED | PDF saved, state record created | STRUCTURED, WAITING_INFO |
| STRUCTURED | Pass-through after extraction | DUPLICATE_CHECK, BLOCKED |
| DUPLICATE_CHECK | Paid registry + pipeline check | VALIDATING, BLOCKED, EXCEPTION_REVIEW |
| VALIDATING | Vendor + bank + tax ID validation | MATCHING, WAITING_INFO, BLOCKED, EXCEPTION_REVIEW |
| MATCHING | 3-way PO matching with tolerance | FRAUD_SCREENING, WAITING_INFO, EXCEPTION_REVIEW, BLOCKED |
| FRAUD_SCREENING | 6-signal fraud scoring | COMPLIANCE, EXCEPTION_REVIEW, BLOCKED |
| COMPLIANCE | GST math + high value check | PAYMENT_READY, EXCEPTION_REVIEW, BLOCKED |
| PAYMENT_READY | Schedule payment, set approver tier | PENDING_APPROVAL |
| PENDING_APPROVAL | Human approval gate | EXCEPTION_REVIEW |
| EXCEPTION_REVIEW | Human decision — approve/block/escalate | APPROVED, BLOCKED, WAITING_INFO, PAYMENT_READY |
| APPROVED | Pass-through to accounting | ACCOUNTING |
| ACCOUNTING | Journal entries + payment execution | COMPLETED, EXCEPTION_REVIEW, BLOCKED |
| COMPLETED | Terminal — invoice paid and closed | — |
| BLOCKED | Terminal — invoice rejected | — |
| WAITING_INFO | Vendor email sent, awaiting resubmission | RECEIVED (on resubmit) |

---

## Project Structure

```
orchestara/
├── app.js                          Express server entry point
├── orchestrator.js                 Central state-machine orchestrator
├── redisClient.js                  Shared Redis singleton
├── db.js                           PostgreSQL connection pool
│
├── agent/                          AI reasoning layer
│   ├── BaseAgent.js                Plan / Act / Observe / Evaluate base class
│   ├── SupervisorAgent.js          Routes state to correct agent
│   ├── IntakeExtractionAgent.js
│   ├── DuplicateAgent.js
│   ├── ValidationAgent.js
│   ├── MatchingAgent.js
│   ├── FraudScoringAgent.js
│   ├── ComplianceAgent.js
│   ├── PaymentAgent.js
│   ├── ExceptionReviewAgent.js
│   └── AccountingAgent.js
│
├── workers/                        Deterministic execution layer
│   ├── IntakeExtractionWorker.js   PDF parsing + LLM extraction
│   ├── DuplicateWorker.js          Paid registry + pipeline check
│   ├── ValidationWorker.js         Vendor + bank + tax validation
│   ├── MatchingWorker.js           PO matching with tolerance
│   ├── FraudScoringWorker.js       6-signal fraud detection
│   ├── ComplianceWorker.js         GST math + high value check
│   ├── PaymentWorker.js            Payment scheduling + approval tier
│   ├── AccountingWorker.js         Journal entries + payment exec
│   ├── ExceptionReviewWorker.js    Decision lookup + auto-resolve
│   ├── NotificationWorker.js       Vendor email via Resend
│   └── SelfHealWorker.js           Kept but removed from pipeline
│
├── core/
│   ├── PolicyEngine.js             Config-driven multi-tenant rules
│   ├── ReflectionService.js        Circuit breaker for repeated failures
│   ├── AgentLogger.js              Agent execution logging
│   ├── workerIdempotency.js        isAlreadyDone / markDone guards
│   └── taxEngineCompliance.js      GST calculation engine
│
├── routes/
│   ├── exceptionReviewRoutes.js    Human approval decisions
│   ├── paymentRoutes.js            Manual payment trigger
│   └── recovery.routes.js          Vendor file resubmission
│
├── modules/
│   └── step1-intake/
│       ├── routes/invoiceIntake.js File upload endpoints
│       └── services/intakeService.js
│
└── monitoring/
    └── sla_monitor.js              SLA enforcement + payment scheduling
```

---

## Fraud Detection — 6 Signals

| Signal | Score | What It Detects |
|---|---|---|
| ROUND_AMOUNT | +15 | Amount divisible by 1000 — common in fabricated invoices |
| FIRST_TIME_VENDOR | +20 | No previous invoices from this vendor in the system |
| RAPID_RESUBMISSION | +25 | Same vendor submitted 2+ invoices within last 24 hours |
| BACKDATED_INVOICE | +20 | Invoice date is more than 30 days in the past |
| AMOUNT_SPIKE | +25 | Amount exceeds 2.5x vendor historical average |
| PO_REUSE | +30 | Same PO number referenced on multiple invoices |

**Thresholds:**
- Score `< 30` → passes to COMPLIANCE
- Score `30 – 60` → routed to EXCEPTION_REVIEW
- Score `> 60` → BLOCKED automatically

---

## Approval Hierarchy

| Amount Range | Required Approver |
|---|---|
| ₹0 – ₹10,000 | FINANCE_MANAGER |
| ₹10,000 – ₹50,000 | VP_FINANCE |
| ₹50,000 – ₹999,999 | CFO |

Tiers are fully configurable per organization via the `approval_config` table. Wrong-role approval attempts are rejected with HTTP 403 and logged to the audit trail.

---

## Accounting Integration

On approval the system automatically creates double-entry journal records:

```
Accrual Entry (on approval):
  Dr  Expense Account    ← cost recorded
  Cr  Accounts Payable   ← liability recorded

Payment Clearance Entry (on payment execution):
  Dr  Accounts Payable   ← liability cleared
  Cr  Bank Account       ← cash goes out
```

### Account Mapping (ORG-1)

| Expense Category | Expense Account (Dr) | AP Account (Cr) |
|---|---|---|
| SOFTWARE | 1002 | 2001 |
| OFFICE_SUPPLIES | 1003 | 2001 |
| TRAVEL | 1004 | 2001 |
| UTILITIES | 1005 | 2001 |
| GENERAL (fallback) | 1001 | 2001 |

---

## Idempotency and Safety

### Worker Idempotency

| Worker | Method | Behavior on Re-run |
|---|---|---|
| IntakeExtractionWorker | ON CONFLICT DO UPDATE | Overwrites extracted data |
| ValidationWorker | ON CONFLICT DO UPDATE | Overwrites validation results |
| MatchingWorker | ON CONFLICT DO UPDATE | Overwrites matching results |
| FraudScoringWorker | ON CONFLICT DO UPDATE | Overwrites fraud score |
| ComplianceWorker | ON CONFLICT DO UPDATE | Overwrites compliance result |
| PaymentWorker | ON CONFLICT DO UPDATE | Overwrites payment schedule |
| AccountingWorker | Existence check on journal_entries | Skips if journal already posted |

### ReflectionService — Circuit Breaker

Monitors `agent_action_log` for repeated failures. If an invoice fails twice in the same state it is automatically routed to EXCEPTION_REVIEW rather than retrying indefinitely. Failure patterns are stored in the `failure_patterns` table for vendor-level analysis.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/invoices/intake/upload` | Upload invoice PDF (multipart/form-data) |
| POST | `/api/invoices/intake/email` | Ingest invoice from email |
| POST | `/api/invoices/intake/api` | Ingest invoice from external system |
| POST | `/api/review/:invoice_id/decision` | Submit human approval decision |
| POST | `/api/payments/:invoice_id/pay` | Manually trigger payment processing |
| POST | `/api/recovery/upload` | Vendor file resubmission via token |

### Submit Approval Decision

```bash
POST /api/review/:invoice_id/decision
Content-Type: application/json

{
  "decision": "APPROVE",
  "reviewer_role": "VP_FINANCE",
  "reviewer_name": "Jane Smith",
  "comment": "Verified and approved"
}
```

> `decision` must be one of: `APPROVE` | `BLOCK` | `ESCALATE`
>
> `reviewer_role` must match the required approval level for this invoice amount. Wrong role returns HTTP 403 and is logged to `audit_event_log`.

---

## SLA Management

`sla_monitor.js` runs every 60 seconds and enforces time-based rules across all active states.

| State | SLA Days | Escalation | Action |
|---|---|---|---|
| RECEIVED | 1 | ESCALATE | Logs escalation, re-emits Redis event |
| VALIDATING | 2 | ESCALATE | Logs escalation, re-emits Redis event |
| MATCHING | 2 | ESCALATE | Logs escalation, re-emits Redis event |
| FRAUD_SCREENING | 1 | ESCALATE | Logs escalation, re-emits Redis event |
| PENDING_APPROVAL | 3 | ESCALATE | Sets escalated=true in workflow table |
| EXCEPTION_REVIEW | 3 | ESCALATE | Logs escalation, re-emits Redis event |
| WAITING_INFO | 10 | AUTO_BLOCK | Sets state to BLOCKED automatically |
| ACCOUNTING | Due date | EXECUTE_PAYMENT | Triggers payment execution when due |

---

## Setup and Installation

### Prerequisites

- Node.js >= 18
- PostgreSQL on port 5433, database: `ap_orchestara`
- Redis via Docker on port 6379
- Ollama with Llama3 model

### Redis — Docker

```bash
docker run -d \
  --name redis-stack \
  -p 6379:6379 \
  -p 8001:8001 \
  redis/redis-stack:latest
```

### Ollama

```bash
ollama run llama3
```

### Install Dependencies

```bash
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5433/ap_orchestara
REDIS_URL=redis://127.0.0.1:6379
BANK_ACCOUNT_ID=3001
```

### Start the System

```bash
# Terminal 1 — API Server
node app.js

# Terminal 2 — Orchestration Engine
node orchestrator.js

# Terminal 3 — SLA Monitor
node monitoring/sla_monitor.js
```

### Submit a Test Invoice

```bash
# PowerShell
curl.exe -X POST http://localhost:3000/api/invoices/intake/upload `
  -F "file=@INV-1001-TEST.pdf" `
  -F "organization_id=ORG-1"

# Approve (once invoice reaches EXCEPTION_REVIEW)
curl.exe -X POST http://localhost:3000/api/review/INVOICE_ID/decision `
  -H "Content-Type: application/json" `
  -d "@approve.json"
```

### Truncate All Pipeline Tables (for clean test runs)

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

## Key Database Tables

| Table | Purpose |
|---|---|
| `invoice_state_machine` | Current state, retry count, SLA timestamps per invoice |
| `invoices` | File path, source, received_at, mime type, file size |
| `invoice_extracted_data` | JSON blob of LLM-extracted invoice fields |
| `invoice_validation_results` | Vendor ID, bank status, tax status, overall status |
| `invoice_po_matching_results` | PO number, match status, variance flags |
| `invoice_fraud_scores` | Risk score and signal list |
| `invoice_compliance_results` | Tax status, high_value_flag |
| `invoice_payment_schedule` | Due date, payment method, payment status |
| `invoice_approval_workflow` | Required level, approval status, escalated flag |
| `exception_review_decisions` | Decision, reviewer, decided_at, processed flag |
| `journal_entries` | Entry type (ACCRUAL/PAYMENT), status |
| `journal_lines` | Account ID, debit and credit amounts |
| `paid_invoice_registry` | Completed invoices — used for duplicate detection |
| `audit_event_log` | Immutable log of every state transition |
| `agent_action_log` | Plan/Act/Evaluate logs per agent per invoice |
| `worker_completion_log` | Idempotency guard — completed states per invoice |
| `agent_reflection_log` | ReflectionService circuit breaker decisions |
| `failure_patterns` | Vendor-level failure pattern accumulator |
| `vendor_master` | Legal name, GSTIN, bank account, country, status |
| `purchase_orders` | PO number, vendor ID, total amount, status |
| `approval_config` | Min/max amount, approver role per organization |
| `sla_config` | State, SLA days, escalation level per organization |
| `tax_rules_master` | Country code, tax type, expected rate, effective dates |
| `account_mapping` | Expense category to account code mapping per org |

---

## Git Branch Structure

| Branch | Purpose |
|---|---|
| `main` | Stable checkpoints only — V5 complete Node.js pipeline |
| `updated_version` | Active development — Python LangGraph migration in progress |
| `clg-project` | College presentation branch — clean demo version |

---

## Author

**Harshavardhan R**
AI Systems Engineering — 2026

> This system is built for enterprise AP automation combining deterministic state machine control with bounded LLM reasoning. All financial decisions are auditable, recoverable, and compliant.
