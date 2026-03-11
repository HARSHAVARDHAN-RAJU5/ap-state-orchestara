# AI Accounts Payable Autonomous Agent

State-driven multi-agent Accounts Payable system that autonomously ingests invoices, validates financial correctness, performs PO matching, evaluates risk using AI, routes approvals, executes payments, and maintains a full audit trail.

The system is built around a deterministic state machine with controlled AI reasoning and strict financial guardrails.

---

# Architecture Overview

The system follows a layered, state-driven architecture:

- Orchestrator controls all invoice state transitions
- Workers perform deterministic execution tasks
- Agents perform reasoning and decision mapping
- PostgreSQL stores authoritative system state
- Redis enables event-driven orchestration
- Guardrails enforce financial correctness and compliance

All state mutations occur only through the orchestrator.

---

# Project Structure

senitac/

agent/
- ApprovalAgent.js
- BaseAgent.js
- DuplicateAgent.js
- ExceptionReviewAgent.js
- IntakeExtractionAgent.js
- MatchingAgent.js
- PaymentAgent.js
- SupervisorAgent.js
- ValidationAgent.js

modules/
- step1-intake/
- step2-extraction/
- step3-validation/
- step4-matching/
- step5-compliance/
- step6-approval/
- step7-payment/
- step8-accounting/

workers/
- AccountingWorker.js
- ApprovalWorker.js
- DuplicateWorker.js
- IntakeExtractionWorker.js
- MatchingWorker.js
- NotificationWorker.js
- PaymentWorker.js
- ValidationWorker.js

monitoring/
- sla_monitor.js

routes/

test/

root files:
- app.js
- orchestrator.js
- db.js
- emit.js
- redisClient.js
- package.json
- .env

---

# Core Concepts

State Machine Lifecycle:

RECEIVED  
STRUCTURED  
DUPLICATE_CHECK  
VALIDATING  
MATCHING  
EXCEPTION_REVIEW  
WAITING_INFO  
PENDING_APPROVAL  
APPROVED  
PAYMENT_READY  
COMPLETED  
BLOCKED  

Transitions are strictly enforced through a STATE_TRANSITIONS policy.

---

# Orchestrator

File: orchestrator.js

Responsibilities:

- Reads invoice current_state
- Selects appropriate worker
- Executes worker
- Invokes agent if reasoning required
- Validates next state
- Persists transition
- Emits next event

The orchestrator is the only component allowed to mutate invoice state.

---

# Workers (Deterministic Layer)

Workers execute financial operations:

- IntakeExtractionWorker — invoice ingestion and structuring
- DuplicateWorker — duplicate detection
- ValidationWorker — invoice validation
- MatchingWorker — purchase order matching
- ApprovalWorker — approval routing
- PaymentWorker — payment scheduling and execution
- AccountingWorker — accounting entry creation
- NotificationWorker — notifications and alerts

Workers do not perform autonomous decision-making.

---

# Agents (Reasoning Layer)

Agents perform reasoning and decision mapping:

- MatchingAgent — AI-based risk reasoning
- ValidationAgent — validation reasoning
- ExceptionReviewAgent — exception handling
- SupervisorAgent — coordination logic

Agents cannot directly update database state.

---

# Data Layer

Database: PostgreSQL  
Event Layer: Redis Streams  

Core tables:

- vendor_master
- invoices
- invoice_line_items
- purchase_orders
- goods_receipts
- invoice_state_machine
- invoice_approval_workflow
- audit_event_log

All records use organization_id for strict multi-tenant isolation.

---

# Guardrails and Safety Controls

The system enforces financial safety using:

- Deterministic state transitions
- Duplicate invoice detection
- PO tolerance validation
- Bank mismatch detection
- Human approval enforcement
- Immutable audit logging
- AI restricted from mutating financial state

---

# Technology Stack

Backend:
- Node.js
- Express.js

Database:
- PostgreSQL

Event Streaming:
- Redis

AI:
- LLM integration for risk classification

Architecture:
- State-driven multi-agent orchestration

---

# How to Run

Step 1: Install dependencies

npm install

Step 2: Start application

npm start

Requirements:

- PostgreSQL running
- Redis running
- Environment variables configured in .env

---

# Testing

Tests are located in:

test/

Run tests using:

npm test

---

# MVP Scope

The MVP supports:

- Autonomous invoice processing
- Deterministic validation and matching
- AI-assisted risk evaluation
- Human approval workflow
- Payment scheduling and execution
- Exception handling and recovery
- Full audit traceability

---

# Design Guarantees

- Deterministic state enforcement
- Controlled AI reasoning
- Human governance over financial decisions
- Full audit traceability
- Multi-tenant isolation

---

# Author

Harshavardhan R
2026
