# Learnings log

Lessons from past sessions on this repo. Read at session start (imported by CLAUDE.md).
Add entries at the top of **Active**. Keep each to 1–3 lines. Newest first.

Entry format:
```
- [tag] YYYY-MM-DD · seen N — **Lesson.** Why / how to apply. (evidence: file:line or command)
```
Tags: `[python]` `[node]` `[db]` `[graph]` `[env]` `[workflow]` `[user]`
- `seen` = how many times this lesson mattered. At 2+, promote it to a rule in CLAUDE.md and remove it here.
- `[user]` = a preference or correction from the user — always record these.
- Don't log what's already in CLAUDE.md, the README, or git history.

## Active

- [env] 2026-10-13 · seen 1 — **The venv lost every `build/` folder** (old `.gitignore` had `build/` while venv was tracked), which broke pip (`No module named 'pip._internal.operations.build'`). Fixed by running pip from the bundled wheel: `$env:PYTHONPATH=<Python311>\Lib\ensurepip\_bundled\pip-24.0-py3-none-any.whl; python -m pip install --force-reinstall --no-deps --no-index <same whl>`. Other packages verified intact via dist-info RECORD check.
- [user] 2026-10-18 · seen 1 — **User switched LLM + embeddings from Ollama to Gemini** (Ollama ran the machine out of memory). Key is a newer 53-char format (not `AIza…`); copy it into `python/.env` with a script, never print it. Prefer stable models (`gemini-embedding-001` @768 dims); list models via `GET /v1beta/models` before assuming a name. Free tier: `gemini-3.8-flash` hit 429/503 within ~10 calls — use `gemini-flash-lite-latest` (ran the 20-question eval with 0 errors). Run long evals in the **foreground**: background jobs get killed when the PC is low on memory.
- [env] 2026-10-17 · seen 1 — **Ollama models live on `F:\ollama\models`** (user env `OLLAMA_MODELS`), which Claude's shell doesn't inherit. If Ollama isn't running, start it with `$env:OLLAMA_MODELS="F:\ollama\models"; ollama serve` — plain `ollama serve` sees no models and `/api/embed` returns 404. Docling's first run downloads ~300 MB of models (took ~9 min); after that ~2–3 s per PDF.
- [env] 2026-10-13 · seen 1 — **Docling is installed in the venv and bumped `requests` to 2.34.2** (requirements.txt pins 2.32.5). `nomic-embed-text` (768-dim) is pulled in Ollama. pgvector is not in the stock Windows Postgres 15 — build with VS 2022 Community (`nmake /F Makefile.win`, admin x64 Native Tools prompt).

- [user] 2026-09-24 · seen 1 — **No `Co-Authored-By` trailer on commits — author is the user only.** When asked to commit/push, use a plain message with no Claude attribution lines. (evidence: commit 106b3cd)

- [workflow] 2026-09-22 · seen 1 — **Never tell the user to `git reset` when `git rm --cached` untracking is staged** — the reset drops the removals and `.gitignore` doesn't untrack already-tracked files, so they silently stay in git. When suggesting a commit split, stage each group explicitly (including `git rm --cached` steps) instead of reset + `add -A`. (evidence: commit bdadaf3 had 12 files instead of ~4,400 deletions; fixed in 2e4ab7b)

- [db] 2026-09-22 · seen 1 — **Check the live DB before calling a column/table "missing".** `db/schema.sql` was stale (no `review_cycle`, no `invoice_payment_approvals`) and nearly led to a false bug report. Query `information_schema.columns` via `python/venv/Scripts/python.exe -B` with `from db import get_connection`.
- [env] 2026-09-22 · seen 1 — **`node_modules` may not be installed** on this machine even though `package-lock.json` exists — run `npm ci` before any Node check.
- [env] 2026-09-22 · seen 1 — **Use `python/venv/Scripts/python.exe -B` directly** for quick checks (langgraph 1.1.3 installed). Shell is Windows with Git Bash; use `curl.exe` in PowerShell, not the `curl` alias.
- [db] 2026-09-22 · seen 1 — **Node stores absolute `file_path`** in `invoices` (built from `__dirname` in intakeService.js), so Python can open it regardless of cwd.

## Promoted / retired
- 2026-09-22 promoted → CLAUDE.md Architecture: self-routing node recurses to `GraphRecursionError`; non-node `next_state` silently ends the run (now handled by `route()` / `STOP_STATES`).
- 2026-09-22 retired: "`git ls-files` flooded by venv" — venv and uploads are no longer tracked.
