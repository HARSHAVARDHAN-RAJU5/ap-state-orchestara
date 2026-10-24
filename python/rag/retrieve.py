from db import get_connection
from rag.embeddings import embed_query, to_pgvector


def build_query(check, invoice, item=None):
    """
    turn one contract check + invoice facts into a search query. shared by the worker and the eval.
    without an explicit item, eval questions use the first line for price and the last line for extra charges.
    """
    if check == "payment_terms":
        return "payment terms: number of days after the invoice date within which payment is due"
    if check == "unit_price":
        item = item or invoice["line_items"][0]
        return f"agreed contract price per unit for {item['description']}"
    if check == "extra_charges":
        item = item or invoice["line_items"][-1]
        return f"is a separate {item['description']} charge allowed to be billed on the invoice"
    raise ValueError(f"unknown check: {check}")


def search(organization_id, vendor_id, query, k=3):
    """
    top-k chunks by cosine similarity, limited to this vendor's contract plus org-wide policies.
    exact scan (no index) - fine for a few thousand chunks.
    """
    vector = to_pgvector(embed_query(query))
    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT c.chunk_id, d.doc_name, c.vendor_id, c.section_title, c.content,
               1 - (c.embedding <=> %s::vector) AS similarity
        FROM contract_chunks c
        JOIN contract_documents d ON d.document_id = c.document_id
        WHERE c.organization_id = %s
          AND (c.vendor_id = %s OR c.vendor_id IS NULL)
        ORDER BY c.embedding <=> %s::vector
        LIMIT %s
        """,
        (vector, organization_id, vendor_id, vector, k)
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {"chunk_id": r[0], "doc_name": r[1], "vendor_id": r[2], "section_title": r[3],
         "content": r[4], "similarity": float(r[5])}
        for r in rows
    ]
