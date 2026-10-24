import json
import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

# LLM_PROVIDER=gemini (default) or ollama
PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta"

# 429 = free-tier per-minute limit, 5xx = model overloaded; both clear up if we wait
RETRY_STATUS = {429, 500, 502, 503, 504}
RETRY_WAITS = [5, 15, 30, 60]


def post_with_retry(url, timeout, **kwargs):
    for wait in RETRY_WAITS + [None]:
        try:
            resp = requests.post(url, timeout=timeout, **kwargs)
        except (requests.Timeout, requests.ConnectionError):
            if wait is None:
                raise
            time.sleep(wait)
            continue
        if resp.status_code not in RETRY_STATUS or wait is None:
            resp.raise_for_status()
            return resp
        # honour the server's hint when it gives one
        hint = resp.headers.get("Retry-After", "")
        time.sleep(float(hint) if hint.isdigit() else wait)


def _gemini(prompt, timeout):
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set in python/.env")
    model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    resp = post_with_retry(
        f"{GEMINI_URL}/models/{model}:generateContent",
        timeout,
        headers={"x-goog-api-key": key},
        json={
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            # json mode + temperature 0: workers need parseable, repeatable output
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
        },
    )
    parts = resp.json()["candidates"][0]["content"]["parts"]
    # skip thinking parts some models return; keep only the answer text
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


def _ollama(prompt, timeout):
    resp = requests.post(
        f"{os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434')}/api/generate",
        json={"model": os.getenv("OLLAMA_MODEL", "llama3"), "prompt": prompt,
              "stream": False, "format": "json", "options": {"temperature": 0}},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()["response"]


def generate_json(prompt, timeout=60):
    """send a prompt, return the parsed JSON object. raises on network errors or invalid JSON."""
    if PROVIDER == "gemini":
        raw = _gemini(prompt, timeout)
    elif PROVIDER == "ollama":
        raw = _ollama(prompt, timeout)
    else:
        raise ValueError(f"unknown LLM_PROVIDER: {PROVIDER}")

    clean = raw.strip()
    # json mode should prevent fences, but strip them if a model adds them anyway
    if clean.startswith("```"):
        clean = clean.split("```")[1]
        if clean.startswith("json"):
            clean = clean[4:]
    return json.loads(clean)
