-- contract rag: store vendor contracts / org policies as embedded chunks,
-- and the per-invoice result of the contract check.
-- safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

-- one row per contract or policy file
CREATE TABLE IF NOT EXISTS contract_documents (
    document_id      SERIAL PRIMARY KEY,
    organization_id  TEXT NOT NULL,
    vendor_id        TEXT,                -- null = org-wide policy
    doc_type         TEXT NOT NULL CHECK (doc_type IN ('contract', 'policy')),
    doc_name         TEXT NOT NULL,
    file_path        TEXT NOT NULL,
    ingested_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (organization_id, doc_name)    -- re-ingest replaces instead of duplicating
);

-- searchable pieces of each document
CREATE TABLE IF NOT EXISTS contract_chunks (
    chunk_id         SERIAL PRIMARY KEY,
    document_id      INT NOT NULL REFERENCES contract_documents ON DELETE CASCADE,
    organization_id  TEXT NOT NULL,
    vendor_id        TEXT,                -- copied from the document so search can filter without a join
    section_title    TEXT NOT NULL,
    chunk_index      INT NOT NULL,
    content          TEXT NOT NULL,
    embedding        vector(768) NOT NULL, -- nomic-embed-text
    content_tsv      tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

-- no hnsw index: exact search is fast enough at this size and never misses
CREATE INDEX IF NOT EXISTS contract_chunks_org_vendor_idx ON contract_chunks (organization_id, vendor_id);
CREATE INDEX IF NOT EXISTS contract_chunks_tsv_idx ON contract_chunks USING GIN (content_tsv);

-- outcome of the contract check per invoice
CREATE TABLE IF NOT EXISTS invoice_contract_check_results (
    invoice_id       TEXT NOT NULL,
    organization_id  TEXT NOT NULL,
    vendor_id        TEXT,
    decision         TEXT NOT NULL CHECK (decision IN ('PASS', 'REVIEW')),
    checks           JSONB NOT NULL,      -- one entry per check: verdict, chunk_id, quote, confidence, verification flags
    reason           TEXT NOT NULL,
    evaluated_at     TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (invoice_id, organization_id)
);
