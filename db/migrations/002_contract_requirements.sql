-- layer 2: what each contract requires of the invoice itself (po number, timesheet, taxes shown...).
-- built by rag/requirements.py, reviewed by a human, then checked per invoice.
-- safe to re-run.

-- pdfplumber text of the invoice, so requirements can be checked against what the vendor actually wrote
ALTER TABLE invoice_extracted_data ADD COLUMN IF NOT EXISTS raw_text TEXT;

CREATE TABLE IF NOT EXISTS contract_requirements (
    requirement_id   SERIAL PRIMARY KEY,
    organization_id  TEXT NOT NULL,
    vendor_id        TEXT,                -- null = org-wide policy
    document_id      INT NOT NULL REFERENCES contract_documents ON DELETE CASCADE,
    section_title    TEXT NOT NULL,
    requirement      TEXT NOT NULL,       -- short plain-english rule
    quote            TEXT NOT NULL,       -- exact sentence from the contract
    needs            TEXT NOT NULL CHECK (needs IN ('invoice_text', 'history', 'attachment', 'other')),
    llm_confidence   REAL,
    second_check     BOOLEAN,             -- result of the separate "is this an invoice requirement?" call
    status           TEXT NOT NULL CHECK (status IN ('auto_approved', 'needs_review', 'approved', 'rejected')),
    problems         JSONB NOT NULL DEFAULT '[]',
    created_at       TIMESTAMP DEFAULT NOW(),
    reviewed_at      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS contract_requirements_org_vendor_idx
    ON contract_requirements (organization_id, vendor_id);
