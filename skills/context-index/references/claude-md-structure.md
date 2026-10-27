# CLAUDE.md structure

Priority-ordered - first lines get highest attention. Keep CLAUDE.md lean; reference-style content goes in topic docs.

1. **Project identity** - one-sentence description + tech stack
2. **Commands** - exact build/test/lint/run CLIs including single-test variant
3. **Architecture** - 2-5 line directory sketch. Deeper layout detail goes into topic docs with specific triggers ("adding a package", "editing CI workflows"), never one `context/architecture.md` behind a catch-all trigger like "navigating the repo"
4. **Workflow conventions** - processes that span tasks ("run lint before commit, not after"; "feature branches, squash on merge"; "run single failing tests in isolation")
5. **Constraints** - hard prohibitions with alternatives ("Never X, use Y instead")
6. `@context/index.md`

The IMPORTANT directive and index entries live inside `context/index.md`, not at root. Inlining them recreates the index and defeats the lazy-load split.

## Keep at root (do NOT extract)

If content's "Use when:" trigger would be "every task", "every commit", or "any change", it's universal - keep it in CLAUDE.md. A lazy trigger that always fires is eager loading with extra steps.

Specifically:

- Commands run every session (build, test, lint, single-test)
- Gates that fire on every commit/PR ("run e2e before committing")
- Universal constraints that apply to any change

## Length

<100 lines ideal. 100-150 acceptable. >150 means something that looks universal is actually domain-scoped - extract it.

Colocated `<dir>/CLAUDE.md` files: <200 lines AND ~2.5k tokens (error at ~5k). A file loads with every colocated CLAUDE.md above it, so keep each stack under ~6k tokens. Over budget, move long-form detail (runbooks, design rationale, reference tables) into a `context/<topic>.md` behind a specific trigger - not into a deeper nested CLAUDE.md, which lengthens the stack. Move, don't copy, and drop history rather than moving it (`references/moving-content.md`).

The always-loaded layer is root CLAUDE.md PLUS the eager `context/index.md` - they load together every session, so budget them jointly and keep the combined size small. Adherence drops as instruction count grows, and accuracy drops with raw context length even when the relevant text is present - so treat every index entry as spending the same budget as a root line. The validator warns when the combined layer exceeds ~2500 tokens.

## Example

```
# acme-api

Node 20 + Fastify + Prisma + Postgres. REST API for the Acme admin console.

## Commands

- `pnpm dev` - start API on :3000 with hot reload
- `pnpm test` - full vitest run
- `pnpm test <path>` - single test file
- `pnpm lint` - eslint + prettier check

## Architecture

- `src/routes/` - HTTP handlers, one file per resource
- `src/services/` - business logic, called from routes
- `src/db/` - Prisma client + migrations
- `test/` - vitest specs mirroring src/

## Workflow

- Run `pnpm lint` and `pnpm test` before every commit
- Feature branches off main, squash on merge

## Constraints

- Never call Prisma from routes - go through `src/services/`
- Never commit `.env` - use `.env.example` as the template

@context/index.md
```
