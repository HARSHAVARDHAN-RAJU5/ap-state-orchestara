---
name: learn
description: Reflect on the current session and update the project's learnings log (.claude/LEARNINGS.md) and CLAUDE.md. Use when the user types /learn, says "remember this", "learn from this", or corrects how Claude worked, and at the end of any long or bumpy task.
---

# /learn — self-learning pass

Run the reflect + consolidate steps of the loop described in `CLAUDE.md` → "Self-learning loop".

## 1. Harvest this session
Go back through the conversation and list candidate lessons from:
- user corrections or stated preferences (always keep these, tag `[user]`)
- commands/tests that failed and what fixed them
- wrong assumptions about the code (what you believed vs. what was true)
- bugs found and their root cause
- shortcuts discovered (a faster way to verify, a file that answers a common question)

If `$ARGUMENTS` is given, treat it as the lesson the user wants recorded and prioritize it.

## 2. Filter
Drop a candidate if it is: already in CLAUDE.md/README, derivable from reading one file, one-off to
this task, or vague ("be careful with X"). Each kept lesson must say **what to do differently** and
have evidence (file:line, command, or the user's words).

## 3. Write
Read `.claude/LEARNINGS.md` first.
- Same lesson already there → bump `seen N`, update date/evidence. Don't duplicate.
- New → add at the top of **Active** in the file's entry format.
- Existing entry contradicted by what you saw → fix or delete it.

## 4. Consolidate
For every entry with `seen ≥ 2`, or any `[user]` rule that should always apply:
- rewrite it as a short imperative rule in the matching section of `CLAUDE.md`
  (Worker contract, Running, Known issues, Conventions)
- remove it from **Active**, leave a one-line pointer under **Promoted / retired**
Also remove any "Known issues" line in CLAUDE.md that has since been fixed (verify in code first).

Keep `LEARNINGS.md` under ~40 active entries; if over, promote or prune the stalest.

## 5. Report
Reply with a short list: added / bumped / promoted / removed, one line each. Don't commit unless asked.
