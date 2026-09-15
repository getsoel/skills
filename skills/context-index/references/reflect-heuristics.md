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

1. **Fix the root cause in code** - remove the sharp edge so the gotcha cannot recur. Bad default returned -> pass the right argument. Wrong-but-silent call -> make it fail loudly up front. A fixed root cause needs no doc and no one to remember it.
2. **Harden the harness** - if you cannot delete it, make a machine catch it: lint rule, validator check, CI gate, type, test, preflight assertion, pre-commit / PostToolUse hook. An enforced invariant beats a documented one - it fires on its own instead of waiting to be read.
3. **Document as an anchored invariant** - only when neither fix nor check is feasible. Write it per `references/anchored-claims.md` (`invariant:` + `verify:`), never as a bare gotcha. A doc works only if the right person reads the right line at the right moment.

**Rung 2 outranks rung 3 only when the check is cheap AND quiet.** A guard earns its place if it is cheap to express and stays under a false-positive budget (Google's static-analysis rule: <=10% effective false positives at review, 0% at compile time; a noisy analyzer gets retired). A noisy `enforce:` is worse than none - it trains everyone to ignore it. Authoring is a real barrier too (in studies ~0% of non-experts could write an AST rule, ~25% with a DSL): when the only available guard is an expert-grade rule nobody will maintain, the honest rung is an anchored `verify:` note, not an aspirational check. Judge a guard by whether the defect class stops recurring (defects FIXED, not found) and keep it at the point of work (CI/validator), never a doc readers must consult.

Most "add a gotcha" instincts are rung 3 grabbing the easiest tool - push up. A candidate that lands on rung 1 or 2 becomes a recommended code/harness change (name the file and the change), NOT a markdown edit.

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
- When in doubt, ask the user per-item
