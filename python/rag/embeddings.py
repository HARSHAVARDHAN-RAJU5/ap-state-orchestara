import os
import requests
from dotenv import load_dotenv

from llm import post_with_retry

load_dotenv()

# EMBED_PROVIDER=gemini (default) or ollama. switching provider means re-running rag.ingest:
# vectors from different models are not comparable.
PROVIDER = os.getenv("EMBED_PROVIDER", "gemini").lower()
EMBED_DIM = 768  # must match contract_chunks.embedding vector(768)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_MODEL = os.getenv("GEMINI_EMBED_MODEL", "gemini-embedding-001")
GEMINI_BATCH = 100  # api limit per batchEmbedContents call

OLLAMA_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
# nomic-embed-text is trained with task prefixes; documents and queries must use different ones
OLLAMA_PREFIX = {"document": "search_document: ", "query": "search_query: "}


def _gemini(texts, kind):
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set in python/.env")
    task = "RETRIEVAL_DOCUMENT" if kind == "document" else "RETRIEVAL_QUERY"
    vectors = []
    for i in range(0, len(texts), GEMINI_BATCH):
        resp = post_with_retry(
            f"{GEMINI_URL}/models/{GEMINI_MODEL}:batchEmbedContents",
            60,
            headers={"x-goog-api-key": key},
            json={"requests": [
                {"model": f"models/{GEMINI_MODEL}", "content": {"parts": [{"text": t}]},
                 "taskType": task, "outputDimensionality": EMBED_DIM}
                for t in texts[i:i + GEMINI_BATCH]
            ]},
        )
        vectors.extend(e["values"] for e in resp.json()["embeddings"])
    return vectors


def _ollama(texts, kind):
    resp = requests.post(
        f"{os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434')}/api/embed",
        json={"model": OLLAMA_MODEL, "input": [OLLAMA_PREFIX[kind] + t for t in texts]},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["embeddings"]


def _embed(texts, kind):
    if PROVIDER == "gemini":
        vectors = _gemini(texts, kind)
    elif PROVIDER == "ollama":
        vectors = _ollama(texts, kind)
    else:
        raise ValueError(f"unknown EMBED_PROVIDER: {PROVIDER}")
    if any(len(v) != EMBED_DIM for v in vectors):
        raise ValueError(f"{PROVIDER} returned a vector that is not {EMBED_DIM}-dim")
    return vectors


def embed_documents(texts):
    return _embed(texts, "document")


def embed_query(text):
    return _embed([text], "query")[0]


def model_name():
    return f"{PROVIDER}:{GEMINI_MODEL if PROVIDER == 'gemini' else OLLAMA_MODEL}"


def to_pgvector(vector):
    # pgvector accepts the '[x,y,...]' text form, so no extra driver package is needed
    return "[" + ",".join(f"{x:.7f}" for x in vector) + "]"
