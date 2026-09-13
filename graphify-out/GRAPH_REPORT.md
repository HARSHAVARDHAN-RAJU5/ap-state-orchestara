# Graph Report - ap-state-orchestara  (2026-09-12)

## Corpus Check
- Corpus is ~17,681 words - fits in a single context window. You may not need a graph.

## Summary
- 197 nodes · 287 edges · 20 communities (8 shown, 8 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Node.js API & Core Services
- Architecture & Migration Docs
- Worker Pipeline & Test Invoice
- Node.js Package Config
- Python Worker Pipeline
- LangGraph State Machine
- Dashboard UI Logic
- NPM Dependencies
- Reflection Service (Circuit Breaker)
- Worker Architecture Overview
- Dashboard Page Entry
- CLG Project Branch Note
- Exception Review Routes Doc
- InvoiceState Schema Doc
- Payment Routes Doc
- Recovery Routes Doc

## God Nodes (most connected - your core abstractions)
1. `Python LangGraph Orchestrator (orchestrator.py)` - 16 edges
2. `InvoiceState` - 15 edges
3. `build_graph()` - 14 edges
4. `pool` - 12 edges
5. `get_connection()` - 11 edges
6. `openDetail()` - 10 edges
7. `graph/nodes.py (LangGraph nodes)` - 9 edges
8. `Invoice INV-1001 (test fixture)` - 8 edges
9. `express` - 7 edges
10. `redis` - 7 edges

## Surprising Connections (you probably didn't know these)
- `compliance_worker.py (GST math + high value flag)` --shares_data_with--> `Invoice INV-1001 (test fixture)`  [INFERRED]
  README.md → test/INV-1001-TEST.pdf
- `openDetail()` --shares_data_with--> `Invoice INV-1001 (test fixture)`  [INFERRED]
  dashborad.html → test/INV-1001-TEST.pdf
- `validation_worker.py (Vendor/bank/tax validation)` --shares_data_with--> `Bank Account HDFC0001234567890`  [INFERRED]
  README.md → test/INV-1001-TEST.pdf
- `validation_worker.py (Vendor/bank/tax validation)` --shares_data_with--> `Tech Supplies Pvt Ltd (Vendor)`  [INFERRED]
  README.md → test/INV-1001-TEST.pdf
- `matching_worker.py (PO matching)` --shares_data_with--> `PO-2024-001 (Purchase Order Number)`  [INFERRED]
  README.md → test/INV-1001-TEST.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Python Invoice Processing Worker Pipeline** — readme_intake_worker, readme_duplicate_worker, readme_validation_worker, readme_matching_worker, readme_fraud_worker, readme_compliance_worker, readme_payment_worker, readme_accounting_worker [EXTRACTED 1.00]
- **ORG-1 Identifier Shared Across README, Dashboard, and Test Invoice** — readme_org_1_reference, dashborad_org_1_const, test_inv_1001_test_org_1 [EXTRACTED 1.00]
- **Invoice State Machine Represented in Docs and Dashboard UI** — readme_state_machine, dashborad_states_const, dashborad_bdg [EXTRACTED 1.00]

## Communities (20 total, 8 thin omitted)

### Community 0 - "Node.js API & Core Services"
Cohesion: 0.10
Nodes (19): app, PolicyEngine, NON_REFLECTABLE_STATES, REFLECTABLE_STATES, pool, router, upload, ALLOWED_MIME (+11 more)

### Community 1 - "Architecture & Migration Docs"
Cohesion: 0.09
Nodes (24): STATES (pipeline state list constant), Harshavardhan R (Author), main branch (stable Node.js pipeline), updated_version branch (Python + LangGraph migration), Clean Test Run (Truncate All Tables), ExceptionReviewWorker (pending, Python), Express API (app.js), graph/builder.py (Graph construction + routing) (+16 more)

### Community 2 - "Worker Pipeline & Test Invoice"
Cohesion: 0.11
Nodes (23): ORG ("ORG-1" constant), accounting_worker.py (Double-entry journal + payment execution), routes/ApprovalRoutes.js (Approval decision endpoint), compliance_worker.py (GST math + high value flag), duplicate_worker.py (Duplicate check), Fraud Detection - 6 Signals, fraud_worker.py (6-signal fraud scoring), graph/nodes.py (LangGraph nodes) (+15 more)

### Community 3 - "Node.js Package Config"
Cohesion: 0.09
Nodes (20): redis, author, description, keywords, license, main, name, scripts (+12 more)

### Community 4 - "Python Worker Pipeline"
Cohesion: 0.11
Nodes (12): get_connection(), listen(), process_invoice(), load_config(), run(), run(), run(), run() (+4 more)

### Community 5 - "LangGraph State Machine"
Cohesion: 0.28
Nodes (15): build_graph(), route(), router_node(), accounting_node(), compliance_node(), duplicate_node(), exception_review_node(), fraud_node() (+7 more)

### Community 6 - "Dashboard UI Logic"
Cohesion: 0.19
Nodes (13): bdg() (status badge renderer), decide(), fmt (formatting helpers object), loadAppr(), loadInv(), loadOv(), loadPage(), loadSLA() (+5 more)

### Community 7 - "NPM Dependencies"
Cohesion: 0.17
Nodes (12): dependencies, axios, dotenv, express, ioredis, multer, nodemailer, pdfjs-dist (+4 more)

## Knowledge Gaps
- **62 isolated node(s):** `app`, `REFLECTABLE_STATES`, `NON_REFLECTABLE_STATES`, `redis`, `upload` (+57 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 81 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Python LangGraph Orchestrator (orchestrator.py)` connect `Architecture & Migration Docs` to `Node.js API & Core Services`?**
  _High betweenness centrality (0.312) - this node is a cross-community bridge._
- **Why does `graph/builder.py (Graph construction + routing)` connect `Architecture & Migration Docs` to `Worker Pipeline & Test Invoice`?**
  _High betweenness centrality (0.220) - this node is a cross-community bridge._
- **Why does `graph/nodes.py (LangGraph nodes)` connect `Worker Pipeline & Test Invoice` to `Architecture & Migration Docs`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Are the 13 inferred relationships involving `InvoiceState` (e.g. with `build_graph()` and `route()`) actually correct?**
  _`InvoiceState` has 13 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `build_graph()` (e.g. with `route()` and `router_node()`) actually correct?**
  _`build_graph()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **What connects `app`, `REFLECTABLE_STATES`, `NON_REFLECTABLE_STATES` to the rest of the system?**
  _62 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Node.js API & Core Services` be split into smaller, more focused modules?**
  _Cohesion score 0.10256410256410256 - nodes in this community are weakly interconnected._