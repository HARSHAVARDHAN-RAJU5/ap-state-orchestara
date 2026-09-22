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

- [db] 2026-09-22 · seen 1 — **Check the live DB before calling a column/table "missing".** `db/schema.sql` was stale (no `review_cycle`, no `invoice_payment_approvals`) and nearly led to a false bug report. Query `information_schema.columns` via `python/venv/Scripts/python.exe -B` with `from db import get_connection`.
- [env] 2026-09-22 · seen 1 — **`node_modules` may not be installed** on this machine even though `package-lock.json` exists — run `npm ci` before any Node check.
- [env] 2026-09-22 · seen 1 — **Use `python/venv/Scripts/python.exe -B` directly** for quick checks (langgraph 1.1.3 installed). Shell is Windows with Git Bash; use `curl.exe` in PowerShell, not the `curl` alias.
- [db] 2026-09-22 · seen 1 — **Node stores absolute `file_path`** in `invoices` (built from `__dirname` in intakeService.js), so Python can open it regardless of cwd.

## Promoted / retired
- 2026-09-22 promoted → CLAUDE.md Architecture: self-routing node recurses to `GraphRecursionError`; non-node `next_state` silently ends the run (now handled by `route()` / `STOP_STATES`).
- 2026-09-22 retired: "`git ls-files` flooded by venv" — venv and uploads are no longer tracked.
