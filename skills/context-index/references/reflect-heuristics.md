# Reflect heuristics

Rules for picking what to keep from a session, where to put it, and what to drop.

## Keep

- Corrections: user said "actually, do it this way" or rejected your first approach
- Non-obvious constraints: hidden coupling, invariants, workarounds for specific bugs
- Decisions with a "why": architectural choices, tradeoffs, precedents
- Commands or flows the user had to teach you
- Patterns that surprised you or that a new agent would miss

## Drop

- Restatements of framework defaults or language syntax
- One-off task details ("we fixed bug #123") - belongs in commit message, not instructions
- Generic best practices ("write tests", "handle errors")
- Anything a linter, formatter, or type checker enforces
- Style preferences with no functional consequence
- Content the codebase already makes obvious (imports, file layout, naming)

## Prefer the fix over the note

IMPORTANT: A gotcha you can write down is usually one you could DELETE. Before documenting any footgun ("watch out for X", "remember to Y", "passes reads but 401s on write"), walk this ladder and propose the HIGHEST feasible rung. Documentation is the last resort, not the default.

1. **Fix it at the source** - remove the sharp edge so the gotcha cannot recur. Bad default returned -> pass the right argument. Wrong-but-silent call -> make it fail loudly up front. First ask WHO OWNS the sharp edge - it is often not this repo:
   - **This repo's code or tooling** (a script, the repo CLI, `package.json`, a missing command that wraps a manual sequence) -> draft the diff.
   - **The user's own machine and agent config** (a shell option such as zsh `nonomatch`, a missing system package, an MCP server missing an output-dir flag or a pinned version, a broken local install) -> the user is right here and owns it: draft the exact change (config line, install command) and APPLY it with their per-item approval, backing up any file first. Then verify it took, from the agent's own shell - a fix that does not reach the agent's environment is not a fix.
   - **Someone else's repo, tool, or system** (an internal CLI that prints banners into `--json` stdout, a helper that hangs on expired auth, a ticket workflow whose required field an automation rule could fill) -> a change request naming the owner, file or setting, and change. Record it as pending (§Pending source fixes).
   A fixed source needs no doc and no one to remember it.

**The ladder is ranked by durability, not by what you can apply alone.** Never pick rung 2 because rung 1 needs someone's approval or another owner's action: present the source fix FIRST, as the recommendation. A guard over a cause with a source fix is at best INTERIM - write it only while the fix is pending, and make it state or check its own removal condition: a preflight that goes silent once the fix lands (`python3 -c 'import yaml'` succeeds -> the row never fires), or a comment naming the pending fix it stands in for. A permanent guard over a fixable cause is the wrong rung.
2. **Harden the harness** - if you cannot delete it, make a machine catch it: lint rule, validator check, CI gate, type, test, preflight assertion, pre-commit hook, or an agent hook (§Writing agent hooks). An enforced invariant beats a documented one - it fires on its own instead of waiting to be read.
3. **Document as an anchored invariant** - only when neither fix nor check is feasible. Write it per `references/anchored-claims.md` (`invariant:` + `verify:`), never as a bare gotcha. A doc works only if the right person reads the right line at the right moment.

**Existing prose + recurrence = escalate.** If a candidate is already covered by a doc line that was loaded and correct, and the problem happened anyway, that doc has failed. Propose the next rung UP for it (a check or a source fix); never reword or restate the doc. A rule that sat in root `CLAUDE.md` and still recurred is the strongest evidence a rung-2 guard is needed.

**Repetition gate.** Propose a rung 1-2 fix or a new doc line only when the same problem shows up in 2+ sessions: check the friction ledger (`context-index gather` reports prior sightings of each failure signature when it has them), earlier handoffs, and the existing docs. A first sighting goes in the session handoff, not the instructions - one session is not a pattern, and fixes fitted to one session are the main way reflect bloats a repo.

**Rung 2 outranks rung 3 only when the check is cheap AND quiet.** A guard earns its place if it is cheap to express and stays under a false-positive budget (Google's static-analysis rule: <=10% effective false positives at review, 0% at compile time; a noisy analyzer gets retired). A noisy `enforce:` is worse than none - it trains everyone to ignore it. Authoring is a real barrier too (in studies ~0% of non-experts could write an AST rule, ~25% with a DSL): when the only available guard is an expert-grade rule nobody will maintain, the honest rung is an anchored `verify:` note, not an aspirational check. Judge a guard by whether the defect class stops recurring (defects FIXED, not found) and keep it at the point of work (CI/validator), never a doc readers must consult.

Most "add a gotcha" instincts are rung 3 grabbing the easiest tool - push up. A candidate that lands on rung 1 or 2 becomes a code/harness/config change, NOT a markdown edit: in this repo or on the user's own machine, draft the actual change for the user to approve with the rest of the batch; for anyone else's, a change request naming the owner, file, and change.

## Pending source fixes

A change request nobody tracks is a fix that never lands, and the guard standing in for it becomes permanent by default. Record each one against the failure signature it fixes: `context-index ledger pending "<signature>" "<fix and owner>"` (take the signature from `context-index gather --json` -> `friction[].signature`). From then on `gather` marks that failure's rows `[source fix pending: …]`. When a later pass sees a pending row:

- **Still recurring** -> the fix has not landed: re-raise it with the owner. Do not add another guard or doc line for it.
- **Landed** (verified) -> `context-index ledger resolve "<signature>"`, and remove any interim guard row that stood in for it.

## Writing agent hooks

An agent hook (e.g. Claude Code's PreToolUse) is the rung-2 guard for a failure the agent causes through a tool call. Write it so it fixes behavior instead of adding friction:

- **Deny with the exact fix.** The message carries the corrected command or call ("pass a bare filename; it saves under `.playwright-mcp/`"), not just "blocked".
- **Fail open.** A hook that errors or cannot parse its input lets the call through; a guard must never wedge the session.
- **Never auto-approve or rewrite.** A hook that returns an allow decision or rewrites the command also skips the user's permission prompt - fix the cause or deny with the fix instead.
- **Preflight environmental failures.** For expired auth, a missing VPN, or a stopped service, check fast (seconds) and deny with the remedy, rather than letting the call hang until its timeout.
- **Don't re-block what is already blocked.** If the agent's own harness already rejects the call, a second guard adds a turn and nothing else.
- **One table-driven guard per repo.** Grow a single guard script whose rows are `{tool, matcher, message}` with a test per row, instead of one script per footgun. A new lesson is then a row plus a test - small, reviewable, and enforced.
- **Quiet beats clever.** Match the narrowest pattern that catches the failure; a guard that fires on correct commands gets disabled.
- **Run the tests before presenting.** Include the row's test and run the guard's suite; a row whose test was never run is a draft, not a fix. Test both the blocked spelling and the near-miss that must pass.
- **No agent-usable bypass.** An override the agent can type itself (a magic comment, an env var in the command) becomes the agent's habit. If a row needs an escape hatch, make it one only the user can grant.

## Failed tool calls are friction too

A tool call that failed for a repo or environment reason (wrong path, missing prerequisite, misused repo CLI, blocked by a guard) is a candidate even when the agent recovered on its own - in practice these outnumber user corrections. Normalize each to a signature ("`git` pathspec beyond a symlink under `notes/`", "`python3` has no `yaml` module") and run it through the ladder like any other footgun. Drop failures that were the intended signal (a test failing while iterating, a grep with no match) and generic harness slips (editing before reading).

**A documented procedure is a script that doesn't exist yet.** When the keeper is an ordered multi-command sequence agents must remember ("run X first, then Y, then Z"), the prose IS the bug: every reader re-executes it from memory and any skipped step recreates the original failure. Rung 1/2 it - wrap the sequence in a repo script (or hook) that makes the right order the only order, and shrink the doc to one line pointing at the script. This applies at WRITE time, not just during a reflect pass: if you catch yourself writing step-by-step commands into CLAUDE.md or a topic doc mid-session, stop and propose the script instead. (`context-index footguns` flags these deterministically as category D `scriptable-procedure`.)

## State snapshots vs durable knowledge

Every keeper is one of two kinds:

- **Durable** - a convention, invariant, or "why"; true until someone decides otherwise -> write it as-is.
- **State snapshot** - what's deployed now, versions, topology, "verified X"; true only until reality moves -> it MUST ride an anchor (`source:`/`verify:`/`stale-by:` per `references/anchored-claims.md`) or be dropped. NEVER land a snapshot as bare dated prose ("verified `<date>`") - that is the form that rots silently while reading authoritative.

## Finding patterns (how to write a keeper)

Write every kept finding in one of these shapes - each leads with the claim, carries its `why:` where the reason isn't obvious, and (when drift-prone) rides an anchor from the canonical anchor vocabulary (`references/anchored-claims.md`). Reuse the shape; don't free-form prose.

- **Convention** -> one line, prohibition + alternative: "Always X / Never Y, prefer Z." Add a `why:` only when the reason isn't obvious from the rule.
- **Decision** -> the choice + `why:` (the forces/precedent), optionally its consequence or trade-off - the proven-minimal ADR shape (Context/Decision/Consequences). `why:` is optional metadata but the highest-value, most-perishable part: a decision with no why gets silently overruled later.
- **Drift-prone state fact** (env, version, endpoint, config) -> an anchored block per `references/anchored-claims.md`: claim + `source:`/`verify:`/`stale-by:`. NEVER bare dated prose.
- **Footgun/invariant** -> only after the remediation ladder (you could neither fix nor check it): `invariant:` (intended state) + `enforce:` (the guard). Use the canonical labels and footgun signal words, not improvised wording - that is what lets the validator and audit READ the finding, not just a human.

In root CLAUDE.md, use only the Convention and Decision shapes. It is always-loaded, so a drift-prone state fact there rots into every session - put state facts in a topic or colocated doc, anchored.

## Classify

Ask two questions: "what trigger would fire this?" then "does it live under a specific directory?"

- "Every task" / "every commit" / "any change" -> universal -> CLAUDE.md root
- Scoped to a directory -> **colocated `<dir>/CLAUDE.md`** (strongly preferred)
- Scoped to related files with no shared directory -> recommend module extraction, then colocate
- Cross-cutting (spans multiple directories, no single home) -> `context/<topic>.md`
- Can't write a trigger -> not instruction material; drop it

## Pick the target file

- Content scoped to a directory -> colocated `<dir>/CLAUDE.md` (append if exists, create if not)
- Content spans directories with no single home, existing `context/<topic>.md` covers it -> append
- Cross-cutting, fits an existing topic but crowded (>200 lines) -> split, propose new filename
- Cross-cutting, new domain -> auto-create `context/<topic>.md`, propose filename from the dominant keyword
- Universal -> CLAUDE.md, in the appropriate section per `references/claude-md-structure.md`

## Naming new topic files

- Single word when possible: `auth.md`, `database.md`, `testing.md`
- Hyphenate only when necessary: `feature-flags.md`, not `featureFlags.md` or `feature_flags.md`
- Match the dominant keyword in the trigger - if the trigger says "touching auth", the file is `auth.md`

## Writing the "Use when:" trigger

The trigger is the ONLY text the model matches a task against to decide whether to load the doc - the index's whole value rides on it. Make it literal, not abstract.

- List concrete cues: task verbs, file paths/globs, framework names, error codes, symbols, symptoms ("seeing 401/403", "hydration error")
- Prefer the words a developer would actually type or see over a topic summary - "touching login, sessions, JWT" beats "authentication concerns"
- One line; the filename already carries the topic

## Personal vs. shared

- API keys, local paths, machine-specific config -> drop (belongs in `CLAUDE.local.md`, which this skill never edits)
- User preferences tied to the project (test runner choice, deployment target) -> shared, goes in `context/` or CLAUDE.md
- How the user likes to work in ANY repo (keep related work in the current PR, fix small in-scope issues instead of filing tickets, how terse to be, ticket style) -> the user's global instruction file (e.g. `~/.claude/CLAUDE.md`), as a one-line convention, only with the user's approval. These recur across sessions and repos; dropping them guarantees the correction repeats.
- When in doubt, ask the user per-item

## Where it loads

Every prose keeper must name its load point (root, a colocated directory, a topic trigger, the user's global file) and the moment it fires. Then check that moment against where the problem actually happens: a fix in `packages/ui/CLAUDE.md` does not reach work in `apps/`; a topic doc whose trigger names the error string loads only after the error it should prevent. If the keeper would not be in context when the problem next arises, move it or climb the ladder - prose that never loads is not a fix.
