---
name: context-index
description: Keep a repo's durable agent knowledge anchored and honest - the lazy-loaded CLAUDE.md + context/index.md structure, its anchored-claims validation, and turning documented footguns into checks. Three subcommands. `reflect` (default) distills the current session's learnings into context/ files or CLAUDE.md. `setup` refactors an existing CLAUDE.md into the two-layer structure. `audit` sweeps the existing corpus for documented footguns that should become code fixes or harness checks. Use `reflect` when the user says "capture what I learned", "update context", "save session notes", or after a session with non-obvious decisions. Use `setup` when the user says "organize my CLAUDE.md", "my CLAUDE.md is too long", or is about to create a CLAUDE.md. Use `audit` when the user says "audit my context docs" or "which saved gotchas could be code fixes".
license: MIT
compatibility: Requires Node.js 18+ (runs the bundled scripts/context-index.mjs). The gather step reads Claude Code transcripts and degrades gracefully elsewhere.
metadata:
  author: getsoel
  repository: https://github.com/getsoel/skills
---

# context-index

Curate the repo's lazy-loaded knowledge: a minimal root `CLAUDE.md`, one eager `context/index.md` (past ~20 entries, fanning out to lazy `context/<area>/index.md` sub-indexes - §Nested indexes), and on-demand `context/<topic>.md` docs routed by "Use when:" triggers. Every deterministic step runs through the bundled checker; this skill supplies the judgment.

## The checker

`scripts/context-index.mjs` (relative to this skill's directory) is a dependency-free Node script. Below, `context-index <cmd>` is shorthand for running it from the target repo:

    node <this-skill-dir>/scripts/context-index.mjs <cmd>

- `<this-skill-dir>` is the directory this SKILL.md was loaded from (e.g. `.claude/skills/context-index`, `.agents/skills/context-index`, or a plugin install path). Resolve it once, then reuse it.
- It scans the git toplevel of the current directory; `--target <path>` points it elsewhere. `--json` gives machine-readable output.
- NEVER reimplement a check by hand when the script can run it. If Node is unavailable, say so and fall back to the prose rules, flagging the pass as unvalidated.

## Subcommands

Three subcommands, dispatched on the argument the user passed (`/context-index audit`, "run context-index setup", ...):

- `reflect` (default) - capture the current session's learnings into `context/` or `CLAUDE.md`
- `setup` - refactor an existing CLAUDE.md into the two-layer structure
- `audit` - sweep the existing corpus for documented footguns that should be code fixes or checks

## Dispatch

- No arg, or arg is `reflect` -> run **Subcommand: reflect**
- Arg is `setup` -> run **Subcommand: setup**
- Arg is `audit` -> run **Subcommand: audit**
- Any other arg -> ask which subcommand the user wants

## Hard rules (all subcommands)

- Root `CLAUDE.md` MUST contain the line `@context/index.md`.
- Index entries MUST be bare paths (no `@` prefix). `@` makes them eager and defeats the design.
- Each index entry - in the root index and in every sub-index - MUST have a "Use when:" trigger, not a topic label.
- Only edit `context/` and `CLAUDE.md` (root + colocated). NEVER edit `CLAUDE.local.md`.
- All generated text MUST follow `references/formatting.md`.
- Before declaring done, `context-index check` MUST pass with zero errors (see §Validation). Prose rules are not self-enforcing - run the gate.

## Subcommand: reflect

Distill the current session into durable instructions.

1. **Gather.** Distill from the session's TRANSCRIPT, not the live context window - after a compaction the window holds a summary, and the corrections, constraints, and "why" this step exists to capture are the first things a summary drops. Run `context-index gather`: it digests the transcript on disk (never compacted) down to human turns verbatim, assistant prose clipped, tool errors kept, the rest dropped. Never read a transcript file directly - a long session is megabytes of tool I/O and would re-flood the context a compaction just freed. It reads Claude Code transcripts; if it reports no transcript (or you are not Claude Code), scan the live context instead and say the pass was degraded. Extraction contract in `references/gather.md`; keep/drop rules in `references/reflect-heuristics.md`.
2. **Classify each candidate.**
   - **Gotcha/footgun? Try to eliminate it first.** Walk the remediation ladder (`references/reflect-heuristics.md` -> "Prefer the fix over the note"): fix the root cause in code, or add a harness check (lint/validator/CI/hook), before treating it as a doc. Surface those as code/harness recommendations (see §Root-cause & harness fixes), not markdown.
   - Universal (fires every task) -> root `CLAUDE.md`.
   - Path-scoped (relevant under a specific directory) -> **colocated `<dir>/CLAUDE.md`** (strongly preferred - see §Colocated CLAUDE.md).
   - Scoped to related files that lack a shared directory -> **recommend extracting a module** (see §Module recommendations), then colocate.
   - Cross-cutting topic, fits an existing `context/<topic>.md` -> append there.
   - Cross-cutting topic, no existing file -> scaffold `context/<topic>.md` + its index entry with `context-index scaffold` (see §Scaffolding).
   - Filler, inferable, linter-handled, or personal -> drop.
3. **Draft changes.** For each keeper: show the exact diff (append, edit, or new file). For new topic docs: show the full file + the new `context/index.md` line. For keepers that are drift-prone state facts (env topology, deployed versions, endpoints, config values, gotchas), anchor per `references/anchored-claims.md` - prefer `source:`/`invariant:`/`verify:` over dated prose.
4. **Confirm.** Present all drafts in one batch (a structured multi-select question where the agent has one, e.g. Claude Code's `AskUserQuestion`). The user approves, edits, or rejects per item.
5. **Apply.** Write approved changes. Scaffold new topic files with `context-index scaffold <name> "<Use-when trigger>"` (see §Scaffolding) - it wires the index entry, so don't hand-edit `context/index.md`. Propose the filename in the draft; don't ask the user to name files.
6. **Verify.** `@context/index.md` still imported; all index entries bare paths with "Use when:" triggers; no universal content leaked into a topic doc; no topic content leaked into `CLAUDE.md`. Then run `context-index check` and resolve every error before declaring done.

## Subcommand: audit

Retroactively sweep the EXISTING corpus for documented footguns that should be code fixes or harness checks, not prose. `reflect` distills THIS session forward; `audit` re-triages what's already saved.

1. **Harvest (deterministic).** Run `context-index footguns --json`. It lists every documented footgun in root/colocated `CLAUDE.md` + `context/**/*.md`, in four ranked categories: A invariant-without-guard (an invariant with no `enforce:`/`verify:` guard - highest signal); D scriptable-procedure (an ordered multi-command sequence in prose - a script/hook that doesn't exist yet); B gotcha/pitfall sections; C hazard phrases ("silently", "passes ... but", "don't forget"). Read-only - it writes nothing.
2. **Triage each through the ladder.** Apply "Prefer the fix over the note" (`references/reflect-heuristics.md`) to every finding: propose (1) a root-cause code fix - cite the file where the sharp edge lives; (2) a harness check - lint/CI/test/type/preflight/hook that would catch it; or (3) keep as an anchored doc when neither is feasible (genuinely external behavior). Rank category A first - you already called those invariants, so they most deserve an `enforce:`.
3. **Confirm.** Present ranked proposals in one batch with the evidence (`file:line` + excerpt). NEVER auto-apply - propose, the user approves per item. Don't propose churn for a footgun that's plainly external/unfixable.
4. **Apply approved.** Make the accepted code fixes / wire the checks; for keep-as-doc items, ensure they ride an anchor per `references/anchored-claims.md`. Leave the rest.
5. **Verify.** Run `context-index check`; resolve every error before done.

## Subcommand: setup

Refactor a project's CLAUDE.md into: minimal root, one eager index, on-demand topic docs.

1. **Audit.** Read the existing `CLAUDE.md` and any `@import`s. Flag: contradictions (ask the user to resolve before continuing); filler (vague platitudes, tautologies, linter-handled rules, things Claude already knows); inlined domain content (auth, framework, schema deep dives belong in `context/<topic>.md`).
2. **Extract.** Move each domain section into `context/<topic>.md`. Each file: self-contained, single-purpose, with a clear "when would I need this?" answer. If there isn't one, it shouldn't be its own file. See `references/topic-example.md` for the canonical shape.
3. **Build the index.** Write `context/index.md` with an IMPORTANT directive plus single-line entries (bare path + "Use when:" trigger). Fold topic-specific keywords (frameworks, error codes, file patterns) into the trigger - that's where they fire. Don't add a separate topic-summary line; the filename already carries the topic. For new topic docs, prefer `context-index scaffold` so the entry is wired by construction.
4. **Curate CLAUDE.md.** Structure per `references/claude-md-structure.md`: identity, commands, architecture, workflow, constraints, `@context/index.md`. Add the import if missing. Flag bloat for removal; flag universal content that belongs at root but was mistakenly extracted.
5. **Verify.** `CLAUDE.md` contains `@context/index.md`; no contradictions; each topic doc self-contained; every index entry has a "Use when:" trigger; all paths resolve; nothing at root would fire on "every task". Then run `context-index check` and resolve every error before declaring done.

## Keep in CLAUDE.md (do NOT extract)

If the best "Use when:" trigger you can write is "every task", "every commit", or "any change", it's universal - leave it at root. A lazy trigger that always fires is eager loading with extra steps.

- Commands run every session (build, test, lint, single-test).
- Gates that fire on every commit/PR ("run e2e before committing").
- Universal constraints that apply to any change.

## Do NOT put in CLAUDE.md or the index

- Code snippets (link to source instead).
- Anything inferable from the code.
- Generic best-practice statements.
- Style rules a linter or formatter enforces.
- Long examples (put them in the relevant topic doc).
- Path-scoped content (use a colocated CLAUDE.md instead - strongly preferred over topic docs).

## Colocated CLAUDE.md

**IMPORTANT: A colocated `<dir>/CLAUDE.md` is the default for any directory-scoped content.** Fall back to `context/<topic>.md` only when the content is genuinely cross-cutting (spans multiple directories with no single home).

Colocate when the content applies to files under a specific directory - `components/`, `routes/auth/`, `lib/payments/`, `scripts/`, feature directories, service directories, monorepo packages. Do NOT colocate when the content references files outside the directory, or is architectural/cross-cutting - use `context/<topic>.md` instead.

When proposing a colocated CLAUDE.md, check whether one already exists at that path; if it does, draft an append. Keep it under 200 lines; when it grows past that, push deep detail into a nested `<subdir>/CLAUDE.md` or a `context/<topic>.md`. Colocated files auto-load when working in that subtree - they don't need an index entry.

## Module recommendations

During reflect, when you find learnings scoped to a set of related files that share no common directory, recommend extracting those files into their own module/directory - it unlocks colocation. Present it as a recommendation, not an action: name the proposed directory, list the files, explain the colocation benefit. The user decides whether to restructure. Don't recommend extraction for only 1-2 files, for files already colocated, or where it fights framework conventions (e.g. Next.js `app/` routing).

## Root-cause & harness fixes

Many "gotcha" candidates are better deleted than documented. Before drafting a doc for any footgun, apply the remediation ladder in `references/reflect-heuristics.md` ("Prefer the fix over the note"): fix the root cause in code, or add a harness check, before falling back to a note. Surface these alongside the drafts - a recommendation, not an action:

- **Root-cause fix** - name the file and the change that removes the sharp edge (the wrong default, the silent-failure call).
- **Harness check** - name the guard that would catch it: lint rule, `context-index check`, CI gate, test, type, preflight assertion, or an agent / pre-commit hook.
- Only when neither is feasible, fall through to an anchored doc per `references/anchored-claims.md`.

## Scaffolding

Create new topic docs by construction, not by hand - `context-index scaffold` generates the file skeleton AND the index entry together, so the wiring (bare path, "Use when:" trigger, no orphan, no dangling pointer) cannot drift. You supply the trigger words and fill the body; the structure is deterministic.

- Run: `context-index scaffold <name> "<Use-when trigger>"` (`--target <path>` to target another repo, `--no-check` to skip the validator run).
- It normalizes the name to the single-word/hyphenated form, refuses if the file or an index entry already exists, inserts the entry grouped with existing `context/` entries, then runs the validator.
- Use it for reflect step 5's new topic files. Fill in the body after - never hand-edit `context/index.md` to add an entry the command would wire correctly.
- In a nested corpus, pass `--in <area>` to create `context/<area>/<name>.md` and wire it into `context/<area>/index.md` instead of the root. The area index must already exist and be listed from a parent index.

## Nested indexes

Past ~20 root entries, split the index by area instead of growing one list - every root entry is paid for on every task.

- Layout: move an area's docs into `context/<area>/`, list them in `context/<area>/index.md` (same bare-path + "Use when:" format), and replace their root entries with ONE entry for the sub-index whose trigger unions the area's routing keywords.
- Only the root index loads eagerly. A sub-index is read when its root trigger fires, then its own triggers route to the doc - two hops, so keep each area coherent enough for one root trigger to name it.
- Entry paths stay repo-relative (`context/<area>/<doc>.md`) at every level.
- `context-index check` walks the tree: every sub-index gets the entry rules plus its own soft cap and overlap check, and a doc or sub-index that no reachable index lists is an orphan.
- Moving a doc changes its path: rewrite every reference (code comments, skills, CI, other docs) in the same change. The validator proves index entries resolve, not prose pointers.

## Validation

A deterministic gate - the prose rules above are not self-enforcing, so every subcommand that writes MUST run this from the target repo and resolve every error before declaring done.

- Run: `context-index check` (scans the current repo; `--target <path>` for another).
- Autofix the one mechanical violation with `--fix` (relocates a misplaced `@context/index.md` import to the last line). Em dashes and smart typography are house style, so punctuation is never rewritten.
- Exit 0 = clean (warnings allowed); exit 1 = errors remain - keep fixing.
- Exclude foreign instruction files (legacy/demo/vendored `CLAUDE.md` the repo doesn't own): add literal paths (no globs) to a `.contextignore` at the repo root, one per line - e.g. `_legacy`, `expo/sports`. A bare name matches that dir/file at any depth; a path with a `/` anchors to the root and skips it plus anything beneath. Use `--ignore <a,b>` for one-offs. Ignore only files you don't author - never to silence real violations in your own corpus.

Scope: root `CLAUDE.md`, the index tree (`context/index.md` plus every `context/<area>/index.md` it lists), every `context/**/*.md`, and colocated `**/CLAUDE.md`.

Catches (errors): orphaned topic docs and sub-indexes (anywhere under `context/`, listed by no index reachable from the root; matched by full path); dangling `context/` pointers; identical-body duplicate docs; index entries missing a "Use when:" trigger or using an eager `@`; missing `@context/index.md` import; length over budget.

Warnings (heuristic smells - review, don't blindly obey): decorative status glyphs (✓✗); backslash-escaped markdown; fenced code block in CLAUDE.md/index (inlined snippet - link to source); external dangling pointers; length over the ideal; an index (root or sub-index) over the ~20-entry soft cap; an index listed twice or in a cycle; always-loaded layer (root + index) over its token budget; triggers sharing distinctive keywords (ambiguous routing); trigger keywords largely absent from their doc (stale/drift); stale path-scoped glob (an entry's optional `; paths:` directory no longer exists); dated state claim with no nearby anchor; `## Commands` after `## Architecture`.

Does NOT catch - still your judgment: whether a flagged overlap/drift is real; classification (universal vs colocated vs cross-cutting); subtle trigger staleness; prose-vs-bullets quality. Verify these by hand.

## Path-scoped activation (optional)

An index entry may append `; paths: \`<glob>\`, \`<glob>\`` after its trigger to deterministically match files (Cursor `globs`-style). The prose trigger stays PRIMARY - globs only cover the path-shaped subset. In Claude Code, the optional `hooks/inject-context.mjs` `PreToolUse` hook surfaces that doc's `## Inject` section (or head) when a matching file is edited - the Claude Code plugin install wires it; see `hooks/README.md` to wire it by hand. Absent `paths:` globs, the hook is a no-op - it is opt-in by index authoring. Other agents ignore the hook; the globs still document scope.

## Anchoring (echo)

Document intended state, not actual state. Push each drift-prone fact up the ladder `source:` > `invariant:`/`enforce:` > `verify:` > `stale-by:` dated prose (`references/anchored-claims.md`). A dated "verified <date>" note with no prover reads authoritative while going wrong on day 2.

## Hard rules (echo)

- Root `CLAUDE.md` MUST import `@context/index.md`.
- Index entries: bare paths + "Use when:" triggers.
- Never touch `CLAUDE.local.md`.
- `context-index check` passes with zero errors before done.
