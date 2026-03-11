<p align="center">
  <h1>AI Accounts Payable Autonomous Agent</h1>
  <p>State-Driven Multi-Agent Financial Orchestration Engine</p>
</p>
# AI Accounts Payable Autonomous Agent
## State-Driven Multi-Agent Financial Orchestration Engine

A production-style system designed to autonomously manage the **end-to-end invoice lifecycle — from ingestion to final payment — using a deterministic state machine to govern AI reasoning.**

This architecture is built for **high-stakes financial environments** where **auditability, safety, and deterministic control are critical.**

---

# 📺 Technical Demo & Walkthrough

**Demo Video**  
https://drive.google.com/file/d/1Dg9g4yk35coTcb8iav1C01iFJT0RRo7T/view

In this **4-minute walkthrough**, the system architecture is demonstrated while processing an invoice with a **PO mismatch exception**.

### The demo shows

- State-driven orchestration of the invoice lifecycle  
- Exception routing through **EXCEPTION_REVIEW**  
- Manual approval flow via terminal command  
- Full forensic audit trail of the system decisions  

---

# 🏗️ Core Engineering Principles

## Deterministic Control

The system strictly separates **AI reasoning** from **financial execution**.

**AI Agents**
- Perform analysis, classification, and anomaly detection
- Provide insights but cannot mutate the database

**Workers**
- Deterministic execution services
- Responsible for state transitions and financial mutations

This design prevents **LLM hallucinations from affecting financial records.**

---

## Multi-Tenant Policy Engine

Organizations can configure financial policies dynamically without modifying code.

Examples include:

- Matching tolerance (e.g. **0.01% variance**)  
- Approval thresholds  
- Payment policies  
- SLA rules  

Policies are stored in **organization-scoped configuration tables.**

---

## Audit-First Design

Every state transition creates an immutable record in:

audit_event_log

Each audit record captures:

- Actor identity
- Timestamp
- Previous state
- New state
- Reason for transition

This provides a **SOC2-ready audit framework.**

---

## Strategic SLA Management

An automated SLA monitoring engine ensures:

- Payments are scheduled based on **invoice due dates**
- **Early payment discount windows** are captured
- Late payment risk is minimized
- Corporate **working capital is optimized**

---

# 🛠️ Technical Architecture

## State Machine Lifecycle

The invoice lifecycle follows a strict deterministic state machine:

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
EXCEPTION_REVIEW
↓
PENDING_APPROVAL
↓
APPROVED
↓
PAYMENT_READY
↓
COMPLETED

Additional system safety states:
WAITING_INFO
BLOCKED


All transitions are enforced by the **Orchestrator**.

---

## Orchestration Layer

### The Orchestrator

The **Orchestrator** is the central authority responsible for:

- Managing state transitions
- Publishing events to the event bus
- Enforcing guardrails
- Coordinating agents and workers

It maintains the authoritative state stored in **PostgreSQL**.

---

### Redis Event Bus

The system uses **Redis Streams** for asynchronous communication.

Benefits:

- Horizontal scalability
- Event-driven architecture
- Independent worker processing
- Non-blocking system execution

---

## Bounded AI Reasoning

AI is used only for **non-deterministic reasoning tasks**, such as:

- Risk classification
- Matching anomaly interpretation
- Exception reasoning

Model used:

Ollama + Llama3

The AI layer **never performs financial mutations**.

---

# 📂 Project Structure

ap-state-orchestrara/

├── agent/ # AI reasoning agents
│ ├── MatchingAgent
│ ├── ValidationAgent
│ └── ExceptionReviewAgent
│
├── workers/ # Deterministic execution workers
│ ├── ExtractionWorker
│ ├── DuplicateWorker
│ ├── MatchingWorker
│ ├── ApprovalWorker
│ └── PaymentWorker
│
├── modules/ # Core invoice lifecycle modules
│
├── monitoring/ # SLA monitoring & payment scheduling
│
├── orchestrator.js # Central state-machine orchestrator
├── redisClient.js # Redis Streams configuration
└── db.js # PostgreSQL connection


---

# 📊 Data Layer & Safety

## Database

**PostgreSQL**

Used as the **authoritative system of record**.

Key properties:

- Strict `organization_id` multi-tenant isolation
- Financial data consistency
- Transactional safety

---

## Event Layer

**Redis Streams**

Provides:

- Event-driven orchestration
- Asynchronous task execution
- Distributed system scalability

---

## Financial Guardrails

The system includes several financial safety checks.

### 3-Way Matching

Invoice
vs
Purchase Order
vs
Goods Receipt


Ensures invoice accuracy before payment approval.

---

### Duplicate Invoice Detection

Invoices are checked using **hash-based fingerprinting** to detect duplicate submissions.

---

### Fraud Protection

Built-in fraud detection mechanisms include:

- **Bank account mismatch alerts**
- Vendor verification workflows
- AI-assisted risk classification

---

# 🚀 Setup & Execution

## Prerequisites

Ensure the following services are running.

### PostgreSQL

Start PostgreSQL locally.

---

### Redis (Docker)

Run Redis Stack:

bash
docker run -d \
  --name redis-stack \
  -p 6379:6379 \
  -p 8001:8001 \
  redis/redis-stack:latest

Ollama

Install Ollama and run the Llama3 model:

ollama run llama3

Install Dependencies

npm install
Start the System

The system requires two services to run.

Start the Orchestration Engine
node orchestrator.js
Start the SLA Monitor
node monitoring/sla_monitor.js

The SLA monitor manages:

payment scheduling

due date monitoring

escalation handling

📄 Technical Documentation

For deeper technical details including:

Architecture design decisions

System ER diagrams

State machine explanation

Failure recovery strategies

Refer to the Technical Design Document (PDF).

Author

Harshavardhan R
AI Systems Engineering
2026
