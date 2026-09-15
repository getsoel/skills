# getsoel/skills

Public Agent Skills repo. Each skill lives in `skills/<name>/` and MUST satisfy the Agent Skills spec (agentskills.io/specification) - `src/skills.test.ts` enforces it.

## Commands

- `bun test` - unit tests, spec checks, and bundle tests under Node
- `bun run build` - rebuild `skills/context-index/scripts/context-index.mjs` from `src/`
- `bun run check` - typecheck + test + build + fail on a stale bundle (what CI runs)

## Constraints

- Commit the rebuilt bundle with every `src/` change; CI fails on a stale one.
- Keep the bundle dependency-free and runnable on Node 18 - it is what users execute, with no install step.
- SKILL.md frontmatter: only spec fields (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`). Tool-specific fields break other installers.
- Never reference a specific agent's tools as required; name them as examples (e.g. Claude Code's `AskUserQuestion`).
- Adding a skill: add it to `.claude-plugin/marketplace.json` and the README table.
