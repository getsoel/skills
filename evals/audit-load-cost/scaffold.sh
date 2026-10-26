#!/usr/bin/env bash
# Fixture: "acme", a small monorepo with a CLAUDE.md + context/index.md corpus.
set -euo pipefail
# prose <n> <topic>: n sentences about <topic>, one per call, joined on one line
prose() {
  local n=$1 topic=$2 i out=""
  local s=(
    "The $topic step reads its settings from the tenant config and fails fast when a key is missing."
    "Run the $topic dry run first; it prints every row it would write without touching the database."
    "Never edit the generated $topic files by hand, because the next seed run overwrites them."
    "When the $topic job retries, it reuses the idempotency key so a second attempt cannot double-write."
    "The staging and production $topic paths differ only in the bucket prefix and the Keycloak realm."
    "A $topic change that touches the schema needs a migration in the same pull request."
    "Logs for the $topic worker carry the tenant slug, so filter on it before reading anything else."
  )
  for ((i=0;i<n;i++)); do out+="${s[$((i % 7))]} "; done
  printf '%s\n' "$out"
}
git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p context packages/cli/provision/tenant-acme
cat > CLAUDE.md <<'MD'
# acme

pnpm monorepo: Node 20 API (`services/api`), React admin (`apps/admin`), provisioning CLI (`packages/cli`).

## Commands

- `pnpm install --frozen-lockfile` - install
- `pnpm test` - all unit tests; `pnpm test <path>` - one file
- `pnpm lint` - oxlint

## Constraints

- Never edit `packages/api-sdk/src/` by hand - run `pnpm generate`
- Soft delete uses a `deleted_at` column, never an `is_deleted` flag

@context/index.md
MD
cat > packages/cli/CLAUDE.md <<'MD'
# packages/cli

- Commands are registered in `src/commands/`; one file per verb.
- `pnpm cli <verb> --target <env>`; `--target prod` needs `--yes`.
MD
cat > context/index.md <<'MD'
# Context index

IMPORTANT: Before any task, scan the entries below. If a "Use when" matches what you are about to do, read that file first. When in doubt, read it.

- `context/architecture.md` - Use when: navigating the monorepo, packages, CI workflows, environment variables
- `context/billing.md` - Use when: changing invoice rounding, Stripe webhook handlers, or `services/api/src/billing/`
MD
{ echo "# Architecture"; echo; echo "Use when: navigating the monorepo, packages, CI workflows, environment variables."; echo
  for i in $(seq 1 60); do echo "- $(prose 4 "monorepo package $i")"; done; } > context/architecture.md
printf '# Billing\n\nInvoices round half-even to the cent. Stripe webhooks are verified in `services/api/src/billing/webhooks.ts`.\n' > context/billing.md
{ echo "# packages/cli/provision"; echo
  for i in $(seq 1 20); do echo "$(prose 5 "provision")"; echo; done; } > packages/cli/provision/CLAUDE.md
{ echo "# tenant-acme seed"; echo
  for i in $(seq 1 25); do echo "$(prose 6 "tenant-acme seed")"; echo; done; } > packages/cli/provision/tenant-acme/CLAUDE.md
mkdir -p .claude/skills/tenant-runbook
{ echo "---"; echo "name: tenant-runbook"
  echo "description: Runbook for standing up a new tenant deployment end to end. Use when provisioning a tenant, onboarding a customer, creating the Config Manager repos, wiring Vault secrets, starting the cloud SQL proxy, dispatching the build-deploy workflow, creating the Keycloak platform organization, issuing domains and certificates, configuring RTMP ingest, seeding the tenant, running the e2e suite against it, debugging a tenant that is live but serving the wrong site, a login that dead-ends at the callback, a certificate that shows ingress.local, a blank page after deploy, or asking what a tenant deploy needs and what non-prod gets to skip."
  echo "---"; echo; echo "# Tenant runbook"; echo
  for i in $(seq 1 60); do echo "$(prose 4 "tenant step $i")"; echo; done; } > .claude/skills/tenant-runbook/SKILL.md
git add -A && git commit -qm "acme fixture"
