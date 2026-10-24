"""
Load contract / policy PDFs into pgvector (contract_documents + contract_chunks).

    cd python
    venv\\Scripts\\python.exe -B -m rag.ingest                      # all PDFs in data/contracts
    venv\\Scripts\\python.exe -B -m rag.ingest path\\to\\file.pdf --org ORG-1

Files named with a vendor id (e.g. ..._VEN-002.pdf) are contracts for that vendor;
anything else is an org-wide policy. Re-running replaces a document's chunks.
After each document is saved its invoice requirements checklist is rebuilt (rag.requirements);
pass --skip-checklist to load chunks only.
"""
import argparse
import re
import sys
import time
from pathlib import Path

from db import get_connection
from rag.embeddings import embed_documents, to_pgvector
from rag.requirements import build_checklist

DEFAULT_DIR = Path(__file__).resolve().parents[2] / "data" / "contracts"
VENDOR_RE = re.compile(r"VEN-\d+", re.IGNORECASE)

# chunk size is in words (~1.3 tokens each): 350 words ≈ 450 tokens
MAX_WORDS = 350
OVERLAP_WORDS = 40
PREAMBLE_MIN_WORDS = 25


def parse_pdf(converter, path):
    """return (title, [(section_title, body_text), ...]) using docling's layout labels."""
    doc = converter.convert(str(path)).document
    title = None
    sections = []
    current_title, current_body = None, []

    for item, _level in doc.iterate_items():
        label = getattr(item, "label", "")
        label = str(getattr(label, "value", label))
        text = (getattr(item, "text", "") or "").strip()
        if not text:
            continue
        if label in ("title", "section_header"):
            if title is None:
                title = text  # first heading names the document
                continue
            if current_body:
                sections.append((current_title, " ".join(current_body)))
            current_title, current_body = text, []
        else:
            # page headers / footers are not yielded by iterate_items, so only body text lands here
            current_body.append(text)

    if current_body:
        sections.append((current_title, " ".join(current_body)))

    # short text before the first heading is a subtitle / label (e.g. "SAMPLE DATA ..."), not a clause
    if len(sections) > 1 and sections[0][0] is None and len(sections[0][1].split()) < PREAMBLE_MIN_WORDS:
        sections = sections[1:]

    # fallback for documents without headings: one big section, split by size below
    sections = [(t or "Full text", b) for t, b in sections]
    return title or path.stem, sections


def split_by_size(body):
    words = body.split()
    if len(words) <= MAX_WORDS:
        return [body]
    pieces, start = [], 0
    while start < len(words):
        pieces.append(" ".join(words[start:start + MAX_WORDS]))
        if start + MAX_WORDS >= len(words):
            break
        start += MAX_WORDS - OVERLAP_WORDS
    return pieces


def build_chunks(doc_name, sections):
    chunks = []
    for section_title, body in sections:
        for piece in split_by_size(body):
            chunks.append({
                "section_title": section_title,
                "content": piece,
                # heading context goes into the embedding only, so stored content stays quotable verbatim
                "embed_text": f"{doc_name}\n{section_title}\n{piece}",
            })
    return chunks


def vendor_exists(cur, organization_id, vendor_id):
    cur.execute(
        "SELECT 1 FROM vendor_master WHERE vendor_id = %s AND organization_id = %s",
        (vendor_id, organization_id)
    )
    return cur.fetchone() is not None


def save_document(organization_id, vendor_id, doc_type, doc_name, file_path, chunks, vectors):
    conn = get_connection()
    cur = conn.cursor()
    try:
        if vendor_id and not vendor_exists(cur, organization_id, vendor_id):
            raise ValueError(f"vendor {vendor_id} not found in vendor_master for {organization_id}")

        cur.execute(
            """
            INSERT INTO contract_documents (organization_id, vendor_id, doc_type, doc_name, file_path, ingested_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (organization_id, doc_name)
            DO UPDATE SET
                vendor_id = EXCLUDED.vendor_id,
                doc_type = EXCLUDED.doc_type,
                file_path = EXCLUDED.file_path,
                ingested_at = NOW()
            RETURNING document_id
            """,
            (organization_id, vendor_id, doc_type, doc_name, file_path)
        )
        document_id = cur.fetchone()[0]

        # replace old chunks in the same transaction so a failed run never leaves a half-loaded document
        cur.execute(
            "DELETE FROM contract_chunks WHERE document_id = %s AND organization_id = %s",
            (document_id, organization_id)
        )
        for i, (chunk, vector) in enumerate(zip(chunks, vectors)):
            cur.execute(
                """
                INSERT INTO contract_chunks
                    (document_id, organization_id, vendor_id, section_title, chunk_index, content, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s::vector)
                """,
                (document_id, organization_id, vendor_id, chunk["section_title"], i,
                 chunk["content"], to_pgvector(vector))
            )
        conn.commit()
        return document_id
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def ingest_file(converter, path, organization_id, checklist=True):
    match = VENDOR_RE.search(path.name)
    vendor_id = match.group(0).upper() if match else None
    doc_type = "contract" if vendor_id else "policy"

    start = time.time()
    doc_name, sections = parse_pdf(converter, path)
    chunks = build_chunks(doc_name, sections)
    if not chunks:
        raise ValueError(f"no text extracted from {path.name} (scanned PDF without OCR?)")
    vectors = embed_documents([c["embed_text"] for c in chunks])
    document_id = save_document(organization_id, vendor_id, doc_type, doc_name,
                                str(path.resolve()), chunks, vectors)

    print(f"  {path.name}: doc {document_id} '{doc_name}' [{doc_type}"
          f"{' ' + vendor_id if vendor_id else ''}] -> {len(chunks)} chunks ({time.time() - start:.1f}s)")

    if checklist:
        # chunks are saved either way; a failed checklist only needs a rebuild, not a re-ingest
        try:
            rows = build_checklist(organization_id, document_id, pause=4)
            auto = sum(r["status"] == "auto_approved" for r in rows)
            print(f"    checklist: {len(rows)} requirement(s), {auto} auto-approved, "
                  f"{len(rows) - auto} need review")
        except Exception as e:
            print(f"    checklist FAILED ({e}) - rerun: python -m rag.requirements build --document-id {document_id}")
    return len(chunks)


def main():
    parser = argparse.ArgumentParser(description="ingest contract / policy PDFs into pgvector")
    parser.add_argument("paths", nargs="*", help="PDF files or folders (default: data/contracts)")
    parser.add_argument("--org", default="ORG-1", help="organization_id to load documents into")
    parser.add_argument("--skip-checklist", action="store_true", help="don't build the requirements checklist")
    args = parser.parse_args()

    files = []
    for p in (Path(x) for x in (args.paths or [DEFAULT_DIR])):
        files.extend(sorted(p.glob("*.pdf")) if p.is_dir() else [p])
    if not files:
        sys.exit("no PDF files found")

    # heavy import kept here so importing rag.* elsewhere (e.g. the worker) never loads docling / torch
    from docling.document_converter import DocumentConverter
    converter = DocumentConverter()

    print(f"ingesting {len(files)} file(s) into {args.org}")
    total, failed = 0, []
    for f in files:
        try:
            total += ingest_file(converter, f, args.org, checklist=not args.skip_checklist)
        except Exception as e:
            failed.append(f.name)
            print(f"  FAILED {f.name}: {e}")

    print(f"done: {len(files) - len(failed)} document(s), {total} chunks"
          + (f", {len(failed)} failed: {failed}" if failed else ""))
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
