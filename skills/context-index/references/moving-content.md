# Moving content

Splitting a file to meet a budget (`setup`, `audit`, an over-budget colocated CLAUDE.md) is where duplicates and stale history are born - a restructure pass that copied rules and carried incident history forward produced most of both in one large corpus. When content moves:

- **Move, don't copy.** Each rule ends in exactly one file (`formatting.md` -> "One home per fact"). Directory-scoped rules stay in the colocated `CLAUDE.md`; the doc takes the detail behind them (runbooks, rationale, reference tables) and does not open by restating them. The source keeps a one-line pointer that names when to read the doc, not a summary of it.
- **Re-judge, don't relocate.** Moved text passes the reflect Keep/Drop rules again (`reflect-heuristics.md`). Incident retellings, rollout and fix logs, "previously it was" notes, and dated validation results are dropped, not moved - git and the commit message keep the history; the doc keeps the rule it taught. Hand-copied counts and lists become a pointer to their source.
- **Check after.** `context-index check` flags word-for-word copies and paths that no longer exist; paraphrased copies it cannot see, so compare each moved section against what stayed behind.
