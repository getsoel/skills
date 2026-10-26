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

IMPORTANT: Read an entry only when your task matches its "Use when". Don't read ahead.

- `context/billing.md` - Use when: changing invoice rounding, Stripe webhook handlers, or `services/api/src/billing/`
MD
printf '# Billing\n\nInvoices round half-even to the cent. Stripe webhooks are verified in `services/api/src/billing/webhooks.ts`.\n' > context/billing.md
# A nested CLAUDE.md stack already near its budget: cli -> provision -> tenant-acme.
{ echo "# packages/cli/provision"; echo
  for i in $(seq 1 20); do echo "- $(prose 3 "provision")"; done; } > packages/cli/provision/CLAUDE.md
{ echo "# tenant-acme seed"; echo
  for i in $(seq 1 22); do echo "- $(prose 3 "tenant-acme seed")"; done; } > packages/cli/provision/tenant-acme/CLAUDE.md
git add -A && git commit -qm "acme fixture"
