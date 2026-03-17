<p align="center">
  <h1>AI Accounts Payable Autonomous Agent</h1>
  <p>State-Driven Multi-Agent Financial Orchestration Engine</p>
</p>

---

A production-style system designed to autonomously manage the **end-to-end invoice lifecycle — from ingestion to final payment — using a deterministic state machine to govern AI reasoning.**

This architecture is built for **high-stakes financial environments** where **auditability, safety, and deterministic control are critical.**

---

## 📺 Technical Demo & Walkthrough

**Demo Video**  
https://drive.google.com/file/d/1Dg9g4yk35coTcb8iav1C01iFJT0RRo7T/view

In this **4-minute walkthrough**, the system architecture is demonstrated while processing an invoice with a **PO mismatch exception**.

### The demo shows

- State-driven orchestration of the invoice lifecycle
- Exception routing through **EXCEPTION_REVIEW**
- Manual approval flow via terminal command
- Full forensic audit trail of all system decisions

---

## 🏗️ Core Engineering Principles

### Deterministic Control

The system strictly separates **AI reasoning** from **financial execution**.

**AI Agents**
- Perform analysis, classification, and anomaly detection
- Provide insights but cannot mutate the database

**Workers**
- Deterministic execution services
- Responsible for state transitions and financial mutations

This design prevents **LLM hallucinations from affecting financial records.**

---

### Multi-Tenant Policy Engine

Organizations can configure financial policies dynamically without modifying code.

Examples include:

- Matching tolerance (e.g. **2% price variance**)
- Approval thresholds and role-based hierarchy
- Payment policies and due date rules
- SLA rules per processing state

Policies are stored in **organization-scoped configuration tables** and loaded per request via `PolicyEngine.js`.

---

### Audit-First Design

Every state transition creates an immutable record in `audit_event_log`.

Each audit record captures:

- Timestamp
- Previous state
- New state
- Reason for transition
- Reviewer identity (for human decisions)

This provides a **SOC2-ready audit framework.**

---

### Strategic SLA Management

An automated SLA monitoring engine ensures:

- Payments are triggered based on **invoice due dates**
- **Early payment discount windows** are captured
- Overdue invoices are automatically escalated or blocked
- Corporate **working capital is optimized**

---

## 🛠️ Technical Architecture

### State Machine Lifecycle

The invoice lifecycle follows a strict deterministic state machine:
```
RECEIVED
↓
STRUCTURED
↓
DUPLICATE_CHECK
↓
VALIDATING
↓
MATCHING
↓
COMPLIANCE
↓
PAYMENT_READY
↓
PENDING_APPROVAL
↓
EXCEPTION_REVIEW  ← human approval gateway
↓
APPROVED
↓
ACCOUNTING        ← journal entries + payment execution
↓
COMPLETED
```

Additional system safety states:
```
WAITING_INFO  ← vendor communication loop
BLOCKED       ← terminal failure state
```

All transitions are enforced by the **Orchestrator**. No agent or worker can mutate state directly.

---

### Orchestration Layer

#### The Orchestrator

The **Orchestrator** is the central authority responsible for:

- Reading current invoice state
- Selecting and executing the appropriate agent
- Validating and committing state transitions
- Publishing events to the Redis event bus
- Enforcing guardrails and retry logic

It maintains the authoritative state in **PostgreSQL**.

---

#### Redis Event Bus

The system uses **Redis Streams** for asynchronous communication.

Benefits:

- Horizontal scalability
- Event-driven architecture
- Independent worker processing
- Non-blocking system execution

---

### Bounded AI Reasoning

AI is used only for **non-deterministic reasoning tasks** such as:

- Invoice data extraction from PDFs
- Risk classification during validation
- Vendor email generation for exception recovery

Model used: **Ollama + Llama3 (local, on-premises)**

The AI layer **never performs financial mutations**. Sensitive financial data never leaves the machine.

---

## 📂 Project Structure
```
ap-state-orchestara/
│
├── agent/                          # AI reasoning agents
│   ├── SupervisorAgent.js          # Routes state to correct agent
│   ├── BaseAgent.js                # plan/act/observe/evaluate pattern
│   ├── IntakeExtractionAgent.js
│   ├── DuplicateAgent.js
│   ├── ValidationAgent.js
│   ├── MatchingAgent.js
│   ├── ComplianceAgent.js
│   ├── ApprovalAgent.js
│   ├── PaymentAgent.js
│   ├── ExceptionReviewAgent.js
│   └── AccountingAgent.js
│
├── workers/                        # Deterministic execution workers
│   ├── IntakeExtractionWorker.js
│   ├── DuplicateWorker.js
│   ├── ValidationWorker.js
│   ├── MatchingWorker.js
│   ├── ComplianceWorker.js
│   ├── ApprovalWorker.js
│   ├── PaymentWorker.js
│   ├── AccountingWorker.js
│   └── NotificationWorker.js
│
├── core/                           # System core services
│   ├── PolicyEngine.js             # Config-driven multi-tenant rules
│   ├── ReflectionService.js        # Failure pattern memory
│   ├── AgentLogger.js              # Agent execution logging
│   └── taxEngineCompliance.js      # Tax validation engine
│
├── routes/                         # API endpoints
│   ├── exceptionReviewRoutes.js    # Human approval decisions
│   ├── paymentRoutes.js            # Manual payment trigger
│   └── recovery.routes.js          # Vendor file recovery
│
├── modules/
│   └── step1-intake/               # Invoice ingestion module
│       ├── routes/invoiceIntake.js
│       └── services/intakeService.js
│
├── monitoring/
│   └── sla_monitor.js              # SLA enforcement + payment scheduling
│
├── orchestrator.js                 # Central state-machine orchestrator
├── redisClient.js                  # Shared Redis Streams client
├── app.js                          # Express server entry point
└── db.js                           # PostgreSQL connection pool
```

---

## 📊 Data Layer & Safety

### Database

**PostgreSQL** — authoritative system of record.

Key properties:

- Strict `organization_id` multi-tenant isolation
- Composite primary keys on all invoice tables
- Immutable audit event log
- Transactional safety on invoice intake

---

### Financial Guardrails

#### 3-Way Matching
```
Invoice  vs  Purchase Order  vs  Goods Receipt
```

Ensures invoice accuracy before payment approval. Configurable tolerance per organization.

---

#### Approval Hierarchy

Invoice amounts are automatically routed to the correct approval tier:

| Amount Range | Required Approver |
|---|---|
| ₹0 – ₹10,000 | FINANCE_MANAGER |
| ₹10,000 – ₹50,000 | VP_FINANCE |
| ₹50,000+ | CFO |

Tiers are fully configurable per organization. Wrong-role approval attempts are rejected and logged.

---

#### Duplicate Invoice Detection

Invoices are checked against both:
- Active invoice pipeline (exact match on invoice number + vendor + amount)
- `paid_invoice_registry` (previously completed invoices)

---

#### Fraud Protection

Built-in fraud detection includes:

- **Bank account mismatch alerts** — triggers vendor verification loop
- Vendor status validation before payment
- AI-assisted risk classification for ambiguous cases

---

#### Accounting Integration

On approval, the system automatically creates double-entry journal records:
```
Dr  Expense Account    ← cost recorded
Cr  Accounts Payable   ← liability recorded
```

Account mapping is configurable per organization and expense category.

---

## 🚀 Setup & Execution

### Prerequisites

#### PostgreSQL

Start PostgreSQL and create the database:
```bash
createdb ap_orchestara
psql -d ap_orchestara -f schema.sql
```

---

#### Redis (Docker)
```bash
docker run -d \
  --name redis-stack \
  -p 6379:6379 \
  -p 8001:8001 \
  redis/redis-stack:latest
```

---

#### Ollama

Install Ollama and pull Llama3:
```bash
ollama run llama3
```

---

### Install Dependencies
```bash
npm install
```

---

### Environment Variables

Create a `.env` file in the root:
```
DATABASE_URL=postgresql://postgres:password@localhost:5433/ap_orchestara
REDIS_URL=redis://127.0.0.1:6379
```

---

### Start the System

**Terminal 1 — Express API Server**
```bash
node app.js
```

**Terminal 2 — Orchestration Engine**
```bash
node orchestrator.js
```

**Terminal 3 — SLA Monitor**
```bash
node monitoring/sla_monitor.js
```

---

### Submit a Test Invoice
```bash
curl -X POST http://localhost:3000/api/invoices/intake/upload \
  -F "file=@invoice.pdf" \
  -F "organization_id=ORG-1"
```

---

### Approve an Invoice
```bash
curl -X POST http://localhost:3000/api/review/{invoice_id}/decision \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "APPROVE",
    "reviewer_role": "VP_FINANCE",
    "reviewer_name": "Approver Name",
    "comment": "Verified and approved"
  }'
```

---

## 📄 Technical Documentation

For deeper technical details including architecture design decisions, system ER diagrams, state machine explanation, and failure recovery strategies — refer to the **Technical Design Document**:

https://drive.google.com/file/d/1gkuYZf6iZAvy8Bgy7jLMgqdrkYa0sMr8/view?usp=drive_link

---

## 👨‍💻 Author

**Harshavardhan R**  
AI Systems Engineering  
2026
