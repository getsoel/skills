---
max_turns: 50
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill]
---

Capture what we learned today about the tenant-acme seed so future sessions have it. Apply it directly - don't stop to ask me to confirm.

- Every tenant-acme seed file under `packages/cli/provision/tenant-acme/` must set `tenantSlug: "acme"` explicitly; the loader no longer defaults it, and a missing slug writes rows to the shared tenant.
- Media fixtures for tenant-acme live in `packages/cli/provision/tenant-acme/media/` and must stay under 2 MB each; larger files time out the B2 upload in CI.
- Run `pnpm cli seed acme --dry-run` before every real seed; it prints every row it would write.
- The tenant-acme seed is not idempotent for `organizations` rows - reseeding duplicates them unless you pass `--reset-orgs`.
