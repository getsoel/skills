---
type: llm
---

PASS if the response flags `packages/cli/provision/tenant-acme/CLAUDE.md` as too large by size or tokens (not merely by line count - it is under 200 lines) AND notes that it loads together with the ancestor CLAUDE.md files above it (`packages/cli/provision/CLAUDE.md`, `packages/cli/CLAUDE.md`), so the combined cost is what matters. FAIL if either point is missing.
