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
rmdir context
# One long CLAUDE.md with everything inlined - the shape `setup` exists to fix.
{
  echo "# acme"; echo
  echo "pnpm monorepo: Node 20 API (\`services/api\`), React admin (\`apps/admin\`), provisioning CLI (\`packages/cli\`), shared UI (\`packages/ui\`)."; echo
  echo "## Commands"; echo
  echo "- \`pnpm install --frozen-lockfile\` - install"
  echo "- \`pnpm test\` - all unit tests; \`pnpm test <path>\` - one file"
  echo "- \`pnpm lint\` - oxlint"
  echo "- \`pnpm dev\` - API on :9000, admin on :3001"; echo
  echo "## Architecture"; echo
  echo "Use this section to find your way around the monorepo."; echo
  echo "### Apps"; echo
  for a in "apps/admin - admin dashboard, scope-based routing (port 3001)" "apps/web - public site, section-based page builder (port 3000)" "apps/marketing - prerendered marketing site (port 3003)" "apps/dashboard - cross-tenant reporting (port 3010)" "apps/mobile - Expo app, shipped from Xcode, not EAS"; do echo "- \`${a%% - *}\` - ${a#* - }"; done; echo
  echo "### Services"; echo
  for a in "services/api - Express API, MySQL, Kysely, OpenAPI-first (port 9000)" "services/dashboard-api - collector behind apps/dashboard, own MySQL" "services/cdn-worker - Cloudflare Worker edge-caching VOD and media"; do echo "- \`${a%% - *}\` - ${a#* - }"; done; echo
  echo "### Packages"; echo
  for d in api api-sdk ui cms auth video capabilities schedule config logger targets cli; do
    echo "- \`packages/$d\` - $(prose 2 "packages/$d")"
  done; echo
  echo "### Directory guide"; echo
  for d in services/api services/api/src/billing services/api/src/auth services/api/migrations apps/admin apps/admin/src/routes packages/ui packages/ui/src/custom packages/cli packages/cli/provision packages/api-sdk packages/config; do
    echo "#### \`$d\`"; echo
    for i in 1 2 3; do echo "- $(prose 1 "$d")"; done; echo
  done
  echo "### CI/CD"; echo
  for w in api-build-deploy api-release admin-build-deploy admin-release web-build-deploy web-release marketing-build-deploy dashboard-build-deploy reusable-build-deploy pr-checks payments-weekly; do echo "- \`.github/workflows/$w.yml\` - $(prose 1 "$w workflow")"; done; echo
  echo "### Environment variables"; echo
  for v in AUTH_ISSUER AUTH_CLIENT_ID AUTH_CLIENT_SECRET AUTH_COOKIE_DOMAIN URL_WEB URL_ADMIN URL_API URL_VIDEO APP_ENV STRIPE_PUBLISHABLE_KEY MIXPANEL_TOKEN UIDEX_PROJECT_KEY; do echo "- \`$v\` - declared in \`turbo.json\` globalEnv; read through \`packages/config\`"; done; echo
  echo "### Monorepo mechanics"; echo
  echo "- Turborepo orchestrates tasks; pnpm workspaces, internal deps use \`workspace:*\`"
  echo "- Vitest everywhere; Playwright flow specs in apps/admin and apps/web"; echo
  for t in "Auth and Keycloak" "Billing and Stripe" "Deploys and environments" "Database migrations" "Testing"; do
    echo "## $t"; echo
    for i in $(seq 1 12); do echo "- $(prose 1 "$t")"; done; echo
  done
  echo "## Constraints"; echo
  echo "- Never edit \`packages/api-sdk/src/\` by hand - run \`pnpm generate\`"
  echo "- Soft delete uses a \`deleted_at\` column, never an \`is_deleted\` flag"
} > CLAUDE.md
git add -A && git commit -qm "acme fixture"
