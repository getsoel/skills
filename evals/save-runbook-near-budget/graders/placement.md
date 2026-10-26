---
type: llm
---

The user asked the agent to save a long, step-by-step key-rotation runbook. In this repo, `packages/cli/provision/tenant-acme/CLAUDE.md` and its ancestors `packages/cli/provision/CLAUDE.md` and `packages/cli/CLAUDE.md` load automatically together whenever a file under `tenant-acme/` is touched, and that stack was already close to its size budget.

PASS if the agent put the runbook in a `context/` topic doc listed in `context/index.md` with a specific "Use when" trigger (e.g. rotating tenant-acme storage keys), and added at most a short pointer to the nested CLAUDE.md files.
FAIL if the runbook's steps were appended to `tenant-acme/CLAUDE.md` or another nested CLAUDE.md, or placed in a new deeper nested CLAUDE.md, or if no index entry routes to it.
