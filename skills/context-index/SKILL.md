---
name: context-index
description: Keep a repo's agent knowledge lean and honest - a minimal CLAUDE.md, a lazy context/index.md routed by "Use when:" triggers, anchored claims, and load budgets, all checked by a bundled validator. `reflect` (default) saves session learnings, `setup` restructures a long CLAUDE.md, `audit` turns documented footguns into fixes and trims what loads every session. Use when capturing learnings, organizing or trimming CLAUDE.md, or auditing context docs and skills.
license: MIT
compatibility: Requires Node.js 18+ (runs the bundled scripts/context-index.mjs). The gather step reads Claude Code transcripts and degrades gracefully elsewhere.
metadata:
  author: getsoel
  repository: https://github.com/getsoel/skills
---

# context-index

Curate the repo's lazy-loaded knowledge: a minimal root `CLAUDE.md`, one eager `context/index.md` (past ~20 entries, fanning out to lazy `context/<area>/index.md` sub-indexes), and on-demand `context/<topic>.md` docs routed by "Use when:" triggers. Every deterministic step runs through the bundled checker; this skill supplies the judgment.

## Hard rules (all subcommands)

- Root `CLAUDE.md` MUST contain the line `@context/index.md`.
- Index entries MUST be bare paths (no `@` prefix). `@` makes them eager and defeats the design.
- Each index entry - in the root index and in every sub-index - MUST have a "Use when:" trigger naming specific situations, not a topic label and not a catch-all ("navigating the repo", "overview").
- NEVER tell the agent to read ahead ("when in doubt, read it", "always read"). A doc loads only when its trigger matches the task.
- Budget what loads in tokens, not lines (§Load budgets). A line budget met by packing paragraphs onto 1,000-char lines is not met.
- Only edit `context/`, `CLAUDE.md` (root + colocated), and - with per-item approval - project skills, repo code/scripts/hooks for a rung 1-2 fix (`references/reflect-heuristics.md`), the user's own machine and agent config for a source fix (back up the file first, verify it took), and the user's global instruction file for personal preferences. NEVER edit `CLAUDE.local.md`, and never change someone else's repo or system - give its owner a change request and record it pending.
- All generated text MUST follow `references/formatting.md`.
- Before declaring done, `context-index check` MUST pass with zero errors (`references/validation.md`).

## The checker

`scripts/context-index.mjs` (relative to this skill's directory) is a dependency-free Node script. Below, `context-index <cmd>` is shorthand for running it from the target repo:

    node <this-skill-dir>/scripts/context-index.mjs <cmd>

- `<this-skill-dir>` is the directory this SKILL.md was loaded from (e.g. `.claude/skills/context-index`, `.agents/skills/context-index`, or a plugin install path). Resolve it once, then reuse it.
- It scans the git toplevel of the current directory; `--target <path>` points it elsewhere. `--json` gives machine-readable output.
- NEVER reimplement a check by hand when the script can run it. If Node is unavailable, say so and fall back to the prose rules, flagging the pass as unvalidated.

## Dispatch

- No arg, or `reflect` -> **Subcommand: reflect** (capture this session's learnings)
- `setup` -> **Subcommand: setup** (refactor an existing CLAUDE.md into the two-layer structure)
- `audit` -> **Subcommand: audit** (re-triage the existing corpus: footguns and load cost)
- Any other arg -> ask which subcommand the user wants

## Load budgets

Every always-loaded token competes with the task, and lazy files are only lazy if their triggers are narrow.

- **Always loaded:** root `CLAUDE.md` + `context/index.md`, ~2.5k tokens combined. Every listed skill and workflow (Claude Code's `.claude/workflows/*.js` `meta.description` + `whenToUse`) also loads every session, at ~75 tokens per entry on top of its text: keep each under 500 chars and the whole listing under ~3k.
- **Loaded on touch:** a colocated `<dir>/CLAUDE.md` loads together with every colocated CLAUDE.md above it. Keep each file under ~2.5k tokens and the whole stack under ~6k. When a file outgrows that, move runbook and reference detail into a `context/<topic>.md` behind a specific trigger - NOT into a deeper nested CLAUDE.md, which only lengthens the stack.
- **Loaded on match:** a topic doc under ~5k tokens. A doc with a broad trigger effectively loads every session - give it specific triggers or move its always-needed lines into `CLAUDE.md`.
- **Loaded on invocation:** a SKILL.md loads whole, and only its first ~5k tokens survive a compaction. Put rules first; move reference detail into `references/`. A skill people start by hand should be hidden from the model where the agent supports it (e.g. Claude Code's `disable-model-invocation`), so its description stops loading every session.

## Subcommand: reflect

Distill the current session into durable instructions.

1. **Gather.** Distill from the session's TRANSCRIPT, not the live context window - after a compaction the window holds a summary, and the corrections, constraints, and "why" this step exists to capture are the first things a summary drops. Run `context-index gather`: it digests the transcript on disk down to human turns verbatim, assistant prose clipped, tool errors kept, the rest dropped. Never read a transcript file directly - it would re-flood the context a compaction just freed. If it reports no transcript (or you are not Claude Code), scan the live context instead and say the pass was degraded. Its `ERR` rows say `[seen in N earlier sessions]` from the repo's friction ledger - the count the repetition gate reads (seed a new repo once with `context-index gather --backfill`). Extraction contract in `references/gather.md`; keep/drop rules in `references/reflect-heuristics.md`.
2. **Classify each candidate.** Candidates are user corrections AND failed tool calls - a call that failed for a repo or environment reason counts even if you recovered (`references/reflect-heuristics.md` -> "Failed tool calls are friction too").
   - **Seen only once?** Apply the repetition gate: a first sighting goes in the session handoff, not the instructions.
   - **Gotcha/footgun? Try to eliminate it first.** Walk the remediation ladder (`references/reflect-heuristics.md` -> "Prefer the fix over the note"): fix it at the source - which may be another repo, a tool's config, or the machine - or add a harness check, before treating it as a doc. Already documented and recurred anyway -> escalate a rung; never reword the doc.
   - How the user works in any repo (PR habits, scope, tone) -> the user's global instruction file, never dropped.
   - Universal (fires every task) -> root `CLAUDE.md`.
   - Path-scoped (relevant under a specific directory) -> **colocated `<dir>/CLAUDE.md`** (§Colocated CLAUDE.md), within its load budget.
   - Scoped to related files that lack a shared directory -> recommend extracting a module (`references/nested-indexes.md`), then colocate.
   - Cross-cutting topic, fits an existing `context/<topic>.md` -> append there.
   - Cross-cutting topic, no existing file -> `context-index scaffold` a new doc + its index entry.
   - Filler, inferable, linter-handled, or personal -> drop.
3. **Draft changes.** For each keeper: show the exact diff (append, edit, or new file) - including rung 1-2 code, script, and hook fixes in this repo, written per "Writing agent hooks". For a source fix on the user's own machine or agent config, draft the exact command or config line - it is applied on approval like any diff. For a fix owned by someone else, draft the change request (owner, file, change) and record it pending (`context-index ledger pending`). Present source fixes before any guard for the same failure; a guard over a fixable cause is interim and says so. For new topic docs: show the full file + the new index line. Name each prose keeper's load point and check it would be in context when the problem recurs (`references/reflect-heuristics.md` -> "Where it loads"). Anchor drift-prone state facts per `references/anchored-claims.md` - prefer `source:`/`invariant:`/`verify:` over dated prose.
4. **Confirm.** Present all drafts in one batch (a structured multi-select question where the agent has one, e.g. Claude Code's `AskUserQuestion`). The user approves, edits, or rejects per item.
5. **Apply.** Write approved changes. Scaffold new topic files with `context-index scaffold <name> "<Use-when trigger>"` - it wires the index entry, so don't hand-edit `context/index.md`.
6. **Verify.** `@context/index.md` still imported; entries are bare paths with specific triggers; no universal content leaked into a topic doc; no topic content leaked into `CLAUDE.md`; nothing you appended pushed a file or stack over its load budget. Then run `context-index check` and resolve every error before declaring done.

## Subcommand: audit

Retroactively sweep the EXISTING corpus. `reflect` distills THIS session forward; `audit` re-triages what's already saved - its footguns, and what it costs to load.

1. **Harvest footguns.** Run `context-index footguns --json`. It lists every documented footgun in four ranked categories: A invariant-without-guard (highest signal); D scriptable-procedure; B gotcha/pitfall sections; C hazard phrases ("silently", "passes ... but"). Read-only.
2. **Harvest load cost.** Run `context-index check --json` and collect the load-cost warnings (`references/validation.md` -> Load cost): always-loaded layer, read-ahead directives, broad triggers, oversized colocated files and stacks, long packed lines, skill and workflow descriptions, SKILL.md bodies, the skill/workflow listing.
3. **Triage.** Footguns go through "Prefer the fix over the note" (`references/reflect-heuristics.md`): (1) root-cause code fix, (2) harness check, or (3) an anchored doc when neither is feasible. Load-cost findings get a concrete trim: rewrite the directive, narrow the trigger, move named sections into a topic doc, shorten the description, split a SKILL.md into `references/`, or hide a hand-started skill from the model. Rank category A footguns and the always-loaded findings first.
4. **Confirm.** Present ranked proposals in one batch with the evidence (`file:line` + excerpt, tokens before -> after). NEVER auto-apply - the user approves per item.
5. **Apply approved, then verify.** Run `context-index check`; resolve every error before done.

## Subcommand: setup

Refactor a project's CLAUDE.md into: minimal root, one eager index, on-demand topic docs.

1. **Audit.** Read the existing `CLAUDE.md` and any `@import`s. Flag: contradictions (ask the user to resolve before continuing); filler (vague platitudes, tautologies, linter-handled rules, things Claude already knows); inlined domain content (auth, framework, schema deep dives belong in `context/<topic>.md`).
2. **Create the index shell FIRST.** If `context/index.md` doesn't exist, write it with a `# Context index` title and this directive, and no entries: `IMPORTANT: Read an entry only when your task matches its "Use when". Don't read ahead.` `context-index scaffold` adds entries INTO an existing index and refuses without one.
3. **Extract + index.** Move each domain section into `context/<topic>.md` with `context-index scaffold <topic> "<Use-when trigger>"`, then fill the body. Each file: self-contained, single-purpose, with a clear "when would I need this?" answer - if there isn't one, it shouldn't be its own file. See `references/topic-example.md`. Fold topic-specific keywords (frameworks, error codes, file patterns) into each trigger. A repo overview is not a topic: its few always-needed lines stay in `CLAUDE.md`, and the rest goes to docs with specific triggers.
4. **Curate CLAUDE.md.** Structure per `references/claude-md-structure.md`: identity, commands, architecture sketch, workflow, constraints, `@context/index.md`. Flag bloat for removal; flag universal content that was mistakenly extracted.
5. **Verify.** No contradictions; each topic doc self-contained; every entry has a specific trigger; all paths resolve; nothing at root would fire on "every task" only by accident. Run `context-index check` and resolve every error before declaring done.

## Keep in CLAUDE.md (do NOT extract)

If the best "Use when:" trigger you can write is "every task", "every commit", "any change", or "navigating the repo", it's universal - keep it at root, trimmed. A lazy trigger that always fires is eager loading with extra steps.

- Commands run every session (build, test, lint, single-test).
- Gates that fire on every commit/PR.
- Universal constraints that apply to any change.

## Do NOT put in CLAUDE.md or the index

- Code snippets (link to source instead), long examples (topic doc).
- Anything inferable from the code; generic best practice; style rules a linter enforces.
- Path-scoped content (use a colocated CLAUDE.md instead).

## Colocated CLAUDE.md

**IMPORTANT: A colocated `<dir>/CLAUDE.md` is the default for directory-scoped rules.** Fall back to `context/<topic>.md` when the content is cross-cutting, or when it is long-form (runbooks, design rationale, reference tables) that only some tasks in that directory need.

- Colocate rules that apply to files under one directory - a package, a service, `routes/auth/`, `scripts/`. Don't colocate content that references files outside the directory.
- Before appending, check the file's size AND its stack (§Load budgets). Over budget -> move detail into a topic doc behind a specific trigger, leaving a one-line pointer.
- Colocated files auto-load when working in that subtree - they don't need an index entry.

## Root-cause & harness fixes

Many "gotcha" candidates are better deleted than documented. Before drafting a doc for any footgun, apply the remediation ladder in `references/reflect-heuristics.md`. Prefer, in order:

- **Source fix** - remove the sharp edge where it lives, and present it FIRST even when you cannot apply it alone. In this repo, or on the user's own machine and agent config: draft the change in the same approval batch as the docs, and verify it took. In someone else's repo or system: a change request naming the owner, file, and change, recorded pending in the ledger - never edit it yourself.
- **Harness check** - a lint rule, `context-index check`, CI gate, test, type, preflight assertion, pre-commit hook, or agent hook (written per "Writing agent hooks"): drafted as a diff, preferably a new row plus test in the repo's existing guard. When a source fix exists for the same cause, the guard is interim: it checks or names its own removal condition.
- Only when neither is feasible, fall through to an anchored doc per `references/anchored-claims.md`.

## References

- `references/validation.md` - what `check` catches (errors, warnings, load cost), `--fix`, `--quiet`, `.contextignore`
- `references/nested-indexes.md` - sub-indexes, `scaffold`, optional `paths:` activation, module recommendations
- `references/claude-md-structure.md`, `references/formatting.md`, `references/topic-example.md` - shape and style
- `references/anchored-claims.md` - `source:` > `invariant:`/`enforce:` > `verify:` > `stale-by:`

## Hard rules (echo)

- Root `CLAUDE.md` MUST import `@context/index.md`.
- Index entries: bare paths + specific "Use when:" triggers; no read-ahead directives.
- Budget loads in tokens: always-loaded ~2.5k, colocated ~2.5k per file and ~6k per stack, skill descriptions under 500 chars.
- Never touch `CLAUDE.local.md`.
- `context-index check` passes with zero errors before done.
