#!/usr/bin/env bash
# Fixture: a lean CLAUDE.md corpus whose startup cost is the skill/workflow listing - eight
# workflows with long meta.description + meta.whenToUse - plus two skills hidden from the model.
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
mkdir -p context .claude/skills .claude/workflows
cat > CLAUDE.md <<'MD'
# acme

pnpm monorepo: Node 20 API (`services/api`), React admin (`apps/admin`).

## Commands

- `pnpm test` - all unit tests; `pnpm test <path>` - one file
- `pnpm lint` - oxlint

@context/index.md
MD
cat > context/index.md <<'MD'
# Context index

IMPORTANT: Read an entry only when your task matches its "Use when". Don't read ahead.

- `context/billing.md` - Use when: changing invoice rounding or Stripe webhook handlers
MD
printf '# Billing\n\nUse when: changing invoice rounding or Stripe webhook handlers.\n\nInvoices round half-even to the cent.\n' > context/billing.md
skill() { # name, description, [hidden]
  mkdir -p ".claude/skills/$1"
  { echo "---"; echo "name: $1"; echo "description: $2"; [ "${3:-}" = hidden ] && echo "disable-model-invocation: true"; echo "---"; echo; echo "# $1"; echo; echo "Steps for $1."; } > ".claude/skills/$1/SKILL.md"
}
skill db "Read-only SQL against the acme MySQL via pnpm cli db. Use when listing tables, counting rows, or resolving an org slug to an id."
skill logs "Search acme service logs with escli. Use when debugging API errors or tracing a request id."
skill api "Look up and call acme API operations with pnpm cli api. Use when finding an endpoint, its auth, or its types."
skill new-tenant "Runbook for standing up a new customer tenant end to end - Config Manager, Vault, DNS, Keycloak org, seeding, e2e. Run by hand." hidden
skill rotate-keys "Runbook for rotating every tenant's storage keys across environments with a verification soak. Run by hand." hidden
flow() { # name
  cat > ".claude/workflows/$1.js" <<JS
export const meta = {
  name: "$1",
  description:
    "Drive a batch of tickets end-to-end through $1: implement each in its own worktree, run an adversarial review with several finder angles, verify every finding, apply the confirmed fixes, validate live with Playwright flows and screenshots, and open one PR per ticket with the evidence attached for a human to review.",
  whenToUse:
    'Invoke with args {tickets: ["ACME-123", ...], baseBranch: "main", details?: {...}, prMode?: true, keepWorktrees?: false, concurrency?: 4}. details skips the tracker fetch. prMode defaults true: nothing merges without a human seeing the screenshots.',
  phases: [{ title: "Implement" }, { title: "Review" }, { title: "Validate" }],
};

export default async function run() {}
JS
}
for f in ticket-pipeline epic-discovery triage stage-audit ui-review ux-walk release-notes dependency-bump; do flow "$f"; done
git add -A && git commit -qm "acme fixture"
