I have updated the technical specifications and execution commands in the documentation to reflect your specific runtime environment, including the Docker-based Redis setup and the local Ollama configuration.

AI Accounts Payable Autonomous Agent
State-Driven Multi-Agent Financial Orchestration Engine

A system designed to autonomously manage the end-to-end invoice lifecycle—from ingestion to final payment—using a deterministic state machine to govern AI reasoning. Built for high-stakes environments where auditability and financial safety are critical.

📺 Technical Demo & Walkthrough
[ LINK TO YOUR VIDEO HERE ](https://drive.google.com/file/d/1Dg9g4yk35coTcb8iav1C01iFJT0RRo7T/view?usp=sharing)
In this 4-minute demo, I walkthrough the state-driven architecture, demonstrating how the system handles a PO-mismatch exception through a manual terminal approval flow and forensic audit trail.

🏗️ Core Engineering Principles
Deterministic Control: Separates Reasoning (AI Agents) from Execution (Deterministic Workers). AI agents provide insights but are strictly prohibited from mutating the database.

Multi-Tenant Policy Engine: Organizations can dynamically configure their own tolerance thresholds (e.g., 0.01% matching variance) and approval authorities without code changes.

Audit-First Design: Every state transition generates an immutable record in the audit_event_log, capturing the actor identity, timestamp, and reasoning (SOC2-ready framework).

Strategic SLA Management: Schedules payments based on due dates and discount windows to optimize corporate working capital.

🛠️ Technical Architecture
1. State Machine Lifecycle
The system enforces a strict, immutable transition policy across 11 states:
RECEIVED → STRUCTURED → DUPLICATE_CHECK → VALIDATING → MATCHING → EXCEPTION_REVIEW → PENDING_APPROVAL → APPROVED → PAYMENT_READY → COMPLETED.

2. Orchestration Layer
The Orchestrator: The single authority for all state transitions. It manages the authoritative state in PostgreSQL and publishes events to Redis.

Redis Event Bus: Utilizes Redis Streams for asynchronous communication, allowing workers and agents to scale horizontally and handle tasks independently.

Bounded AI (Ollama/Llama3): Performs non-deterministic tasks like risk classification and anomaly detection. It is restricted from performing financial mutations.

📂 Project Structure
Plaintext
senitac/
├── agent/            # AI Reasoning (Matching, Validation, Exception Review)
├── workers/          # Deterministic Execution (Extraction, Duplicate Check, Payment)
├── modules/          # Core business logic steps (Intake to Accounting)
├── monitoring/       # SLA and Cash-Flow optimization logic
├── orchestrator.js   # Central state-machine logic
├── redisClient.js    # Event bus configuration
└── db.js             # PostgreSQL connection & Multi-tenant schema
📊 Data Layer & Safety
Database: PostgreSQL (Authoritative State Store) with strict organization_id isolation.

Event Layer: Redis Streams (Running via Docker) for event-driven orchestration.

Safety Guardrails: * 3-Way Matching (Invoice vs. PO vs. Goods Receipt).

Hash-based duplicate invoice detection.

Bank account mismatch alerts and fraud detection.

🚀 Setup & Execution
1. Prerequisites
PostgreSQL: Ensure service is running.

Redis: Must be running via Docker.

Bash
docker run -d --name redis-stack -p 6379:6379 -p 8001:8001 redis/redis-stack:latest
Ollama: Must be running locally with the Llama3 model.

Bash
ollama run llama3
2. Install Dependencies
Bash
npm install
3. Start the System
The system requires both the Orchestrator and the SLA Monitor to be active:

Start the Orchestration Engine:

Bash
node orchestrator.js
Start the SLA & Payment Monitor:

Bash
node monitoring/sla_monitor.js
📄[ Technical Documentation ](https://drive.google.com/file/d/1gkuYZf6iZAvy8Bgy7jLMgqdrkYa0sMr8/view?usp=sharing)
For a deep dive into the system design, ER diagrams, and architectural trade-offs, refer to the Technical Design Document (PDF).

Author: Harshavardhan R (2026)
