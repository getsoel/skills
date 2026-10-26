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
cat > packages/cli/provision/CLAUDE.md <<'MD'
# packages/cli/provision

- One directory per tenant; each exports `seed(ctx)` from `index.ts` and reads its data from JSON beside it.
- `ctx.db` is a Kysely transaction - a thrown error rolls back the whole tenant seed.
- `pnpm cli seed <tenant> --target <env>`; `--target prod` also needs `--yes`.
- Never import one tenant's fixtures from another tenant's directory; copy them.
MD
# Under every line budget but ~6k tokens: distinct, specific facts packed onto long lines -
# the shape that grows when every session appends to the nearest CLAUDE.md.
python3 - <<'PY'
import random
r = random.Random(7)
tables = ["organizations", "venues", "events", "streams", "products", "prices", "memberships", "invitations", "sections", "media", "schedules", "playlists"]
fields = ["slug", "timezone", "sort_order", "visibility", "currency", "starts_at", "poster_id", "theme_id", "capacity", "region"]
why = ["the admin list sorts on it and a null puts the row first", "the public site 404s when it is missing", "the nightly reconciler rejects the row otherwise",
       "the mobile app caches by it and never refreshes", "the CDN key is derived from it", "the payments ledger joins on it",
       "Keycloak group sync keys off it", "the importer upserts on it and duplicates without it"]
people = ["Priya", "Marco", "Dana", "Jun", "Tomasz", "Aisha"]
out = ["# tenant-acme seed", "", "## Seed rules", ""]
for i, t in enumerate(tables):
    f1, f2 = r.sample(fields, 2)
    out.append(f"- `{t}.json` ({r.randint(3, 140)} rows): every row needs `{f1}` and `{f2}`; `{f1}` because {r.choice(why)}, and `{f2}` because {r.choice(why)}. "
               f"Rows are inserted after `{tables[i - 1]}` so foreign keys resolve; the fixture ids run from {1000 + i * 100} to {1000 + i * 100 + 99}, and ids below that range belong to the shared tenant. "
               f"If you add a row, also add it to `expected/{t}.snap` or the seed test fails with a count mismatch, not a useful diff.")
out += ["", "## Reseed history", ""]
for n in range(26):
    t = r.choice(tables); f = r.choice(fields)
    out.append(f"{2025 + n // 8}-{(n % 8) + 3:02d}: {r.choice(people)} reseeded staging after `{t}.{f}` drifted from production; the fix was to "
               f"{r.choice(['regenerate the snapshot', 'backfill the column in a migration first', 'pin the fixture to the production export', 'drop the stale rows by id range'])} "
               f"and rerun with `--only {t}`. It took {r.randint(2, 9)} attempts because {r.choice(why)}; the lasting rule from it is that `{t}` rows are never edited in place, only replaced by id. "
               f"Ticket ACME-{r.randint(100, 999)} has the before and after counts ({r.randint(10, 400)} vs {r.randint(10, 400)}).")
    out.append("")
open("packages/cli/provision/tenant-acme/CLAUDE.md", "w").write("\n".join(out))
PY
git add -A && git commit -qm "acme fixture"
