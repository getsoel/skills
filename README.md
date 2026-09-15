# getsoel/skills

Agent skills from getsoel. Every skill follows the [Agent Skills spec](https://agentskills.io/specification), so it works in Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, and any other agent that reads `SKILL.md`.

| Skill | What it does |
| --- | --- |
| [`context-index`](skills/context-index/SKILL.md) | Keeps a repo's lazy-loaded `CLAUDE.md` + `context/index.md` knowledge anchored and honest. Captures session learnings, refactors a bloated `CLAUDE.md`, audits documented footguns, and validates the result with a bundled checker. |

## Install

### Any agent

```bash
npx skills add getsoel/skills --skill context-index
```

This installs into the current project (for example `.claude/skills/` or `.agents/skills/`). Commit the result so everyone who clones the repo gets the skill. Add `-g` to install for yourself across all projects instead.

### Claude Code plugin

```
/plugin marketplace add getsoel/skills
/plugin install context-index@getsoel
```

The plugin also wires the optional `inject-context` hook ([details](skills/context-index/hooks/README.md)).

To give everyone on a repo the plugin, commit this to its `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "getsoel": { "source": { "source": "github", "repo": "getsoel/skills" } }
  },
  "enabledPlugins": { "context-index@getsoel": true }
}
```

## context-index

Three subcommands:

- `reflect` (default): distill the current session's learnings into `context/` docs or `CLAUDE.md`
- `setup`: refactor an existing `CLAUDE.md` into a minimal root, one eager index, and on-demand topic docs
- `audit`: find documented footguns that should become code fixes or checks

Every deterministic step runs through `skills/context-index/scripts/context-index.mjs`, a dependency-free Node script (Node 18+). You can run it yourself, for example in CI or a pre-commit hook:

```bash
node .claude/skills/context-index/scripts/context-index.mjs check --quiet
```

| Command | Does |
| --- | --- |
| `check` | Validates the corpus: orphans, dangling pointers, eager `@` imports, missing "Use when:" triggers, length budgets, trigger overlap and drift. Exits 1 on errors. |
| `ls` | Lists the index tree |
| `scaffold <name> "<trigger>"` | Creates a topic doc and wires its index entry |
| `footguns` | Lists documented footguns, ranked |
| `gather` | Digests the current Claude Code session transcript for `reflect` |

Exclude foreign instruction files (vendored or legacy `CLAUDE.md`) by listing literal paths in a `.contextignore` at the repo root.

## Development

The checker's source lives in `src/` and is bundled into the skill with Bun.

```bash
bun install
bun test           # unit tests + the Agent Skills spec checks + bundle tests under Node
bun run build      # rebuild skills/context-index/scripts/context-index.mjs
bun run check      # typecheck, test, build, and fail if the committed bundle is stale
```

Commit the rebuilt bundle with any change to `src/`. CI fails when it is stale.

## License

MIT
