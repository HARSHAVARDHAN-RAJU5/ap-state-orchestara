AI Accounts Payable Autonomous Agent
State-Driven Multi-Agent Financial Orchestration Engine

A production-style system designed to autonomously manage the end-to-end invoice lifecycle — from ingestion to final payment — using a deterministic state machine to govern AI reasoning.

This architecture is built for high-stakes financial environments where auditability, safety, and deterministic control are critical.

📺 Technical Demo & Walkthrough

Demo Video: (https://drive.google.com/file/d/1Dg9g4yk35coTcb8iav1C01iFJT0RRo7T/view?usp=drive_link)

In this 4-minute walkthrough, the system architecture is demonstrated while processing an invoice with a PO mismatch exception.

The demo shows:

State-driven orchestration of the invoice lifecycle

Exception routing through EXCEPTION_REVIEW

Manual approval flow via terminal command

Full forensic audit trail of the system decisions

🏗️ Core Engineering Principles
Deterministic Control

The system enforces strict separation between AI reasoning and financial execution.

AI Agents

Perform analysis, classification, and anomaly detection

Cannot mutate the database

Workers

Deterministic services that perform state transitions

Responsible for all financial mutations

This ensures LLM hallucinations cannot impact financial records.

Multi-Tenant Policy Engine

Organizations can dynamically configure financial policies without code changes.

Examples:

Matching tolerance (e.g. 0.01% variance)

Approval thresholds

Payment policies

SLA rules

All policies are stored in organization-scoped configuration tables.

Audit-First Design

Every state transition generates an immutable record inside:

audit_event_log

Each record contains:

actor_identity

timestamp

previous_state

new_state

reason_for_transition

This architecture provides a SOC2-ready audit framework.

Strategic SLA Management

The system includes an SLA monitoring engine which:

Schedules payments based on due dates

Detects discount windows

Prevents late payments

Optimizes working capital utilization

🛠️ Technical Architecture
State Machine Lifecycle

The invoice lifecycle is governed by a strict state machine:

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

Additional safety states:

WAITING_INFO
BLOCKED

All transitions are enforced by the Orchestrator.

Orchestration Layer
The Orchestrator

The Orchestrator is the single authority responsible for:

State transitions

Event emission

Workflow coordination

Guardrail enforcement

It reads and writes the authoritative state stored in PostgreSQL.

Redis Event Bus

The system uses Redis Streams for asynchronous orchestration.

Benefits:

Horizontal scalability

Worker isolation

Event-driven execution

Non-blocking architecture

Bounded AI Reasoning

AI models are used only for non-deterministic reasoning tasks, including:

Risk classification

Matching anomaly interpretation

Exception analysis

Model:

Ollama + Llama3

The AI never performs financial mutations.

📂 Project Structure
senitac/

├── agent/                 # AI reasoning agents
│   ├── MatchingAgent
│   ├── ValidationAgent
│   └── ExceptionReviewAgent
│
├── workers/               # Deterministic execution workers
│   ├── ExtractionWorker
│   ├── DuplicateWorker
│   ├── MatchingWorker
│   ├── PaymentWorker
│
├── modules/               # Core invoice lifecycle logic
│
├── monitoring/            # SLA monitoring and payment scheduler
│
├── orchestrator.js        # State-machine orchestration engine
├── redisClient.js         # Redis Streams configuration
└── db.js                  # PostgreSQL connection
📊 Data Layer & Safety
Database

PostgreSQL

Used as the authoritative state store.

Key properties:

strict organization_id isolation

multi-tenant schema design

financial consistency guarantees

Event Layer

Redis Streams

Provides:

event-driven orchestration

asynchronous worker execution

distributed system scalability

Financial Guardrails

The system enforces multiple safety mechanisms:

3-Way Matching
Invoice
   vs
Purchase Order
   vs
Goods Receipt
Duplicate Detection

Invoices are checked using hash-based fingerprinting to detect duplicates.

Fraud Protection

The system includes:

Bank account mismatch alerts

Vendor verification workflows

Risk classification using AI

🚀 Setup & Execution
Prerequisites

Ensure the following services are running.

PostgreSQL

Start PostgreSQL locally.

Redis (Docker)

Run Redis Stack:

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

The system requires two services.

Start the Orchestration Engine
node orchestrator.js
Start the SLA Monitor
node monitoring/sla_monitor.js

This service manages:

payment scheduling

SLA monitoring

escalation logic

📄 Technical Documentation

For a deeper explanation of the architecture, including:

system design decisions

ER diagrams

architectural trade-offs

failure recovery strategies

Refer to the Technical Design Document (PDF).
https://drive.google.com/file/d/1gkuYZf6iZAvy8Bgy7jLMgqdrkYa0sMr8/view?usp=sharing

Author

Harshavardhan R
AI Systems Engineering
2026
