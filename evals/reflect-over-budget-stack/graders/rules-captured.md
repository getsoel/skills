---
type: llm
focus: { source: file, path: packages/cli/provision/tenant-acme/CLAUDE.md }
---

The user asked the agent to save four rules about the tenant-acme seed: (1) every seed file sets `tenantSlug: "acme"` explicitly, (2) media fixtures stay under 2 MB, (3) run `pnpm cli seed acme --dry-run` first, (4) the seed is not idempotent for organizations rows unless `--reset-orgs` is passed.

This is `packages/cli/provision/tenant-acme/CLAUDE.md` after the run. PASS if the file states all four rules, or states the ones it keeps and points to a `context/` doc for the rest. FAIL if any rule is neither in the file nor pointed to.
