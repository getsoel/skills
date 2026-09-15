# Formatting

Rules for any instruction text: SKILL.md, README, CLAUDE.md, index entries, topic docs.

## Structure

- Bullets over prose - terse, scannable, each line stands alone
- Tables only for tabular data - use bullets for lists and rules
- Headers (`#`) for section structure; horizontal rules (`---`) for major breaks only
- Hard rules in the first 20 lines, echo in the last 10 - attention drops in the middle of long files

## Length

- General instruction files and topic docs: <200 lines
- CLAUDE.md: <100 lines ideal (see `references/claude-md-structure.md`)
- Performance degrades as context accumulates; extract when a doc grows past its budget

## Voice

- Imperative, not polite - "Use TypeScript strict mode" not "Could you please ensure..."
- **IMPORTANT** / **MUST** / **NEVER** increase compliance
- Specify the constraint, not the freedom - state what MUST be true; don't restate defaults ("preserve existing content", "you can keep whatever you want") - they inflate tokens without changing behavior
- "Always X / Never Y, prefer Z" - pair prohibition with alternative on one line

## Vocabulary

- Em dashes (—), en dashes, and smart quotes are ACCEPTABLE - they are a house-style choice, not something to strip; match the repo's existing punctuation. What to avoid is DECORATIVE status glyphs (✓ ✗ ✅ ❌) and decorative arrows used as bullets (→) - they cost tokens with no information gain. The validator only warns on the decorative glyphs (and backslash-escapes); it does not flag em dashes or smart punctuation.
- Common abbreviations OK: `config`, `repo`, `env`, `docs`
- Only abbreviate when there's clear token savings - most common English words are already single tokens
- Backtick paths, globs, and env-var patterns: `` `@scope/*` ``, `` `NEXT_PUBLIC_*` ``, `` `@types/*` `` - a bare `*` or `_` renders as markdown emphasis and invites ugly `\*` escapes

## Index-entry specifics

- Single line: bare path + `Use when:` trigger
- No separate topic-summary line - filename carries the topic
- Fold unique keywords (frameworks, error codes, file patterns, symptoms like "401/403" or "hydration error") into the trigger - that's where they match
- Triggers route loading, so favor LITERAL lexical cues (task verbs, file globs, error codes, symbol names) over abstract topic descriptions - models match literal overlap far more reliably than latent semantics, and semantic-only matching is the regime that degrades most as context fills
- OPTIONAL path-scoped activation: append `` ; paths: `<glob>`, `<glob>` `` after the trigger to deterministically match files (Cursor `globs`-style). Backtick each glob; `*` stays within a path segment, `**` crosses `/`. The validator flags a glob whose directory no longer exists; the skill's optional `inject-context` hook (Claude Code) can surface the doc when a matching file is edited. The prose trigger stays PRIMARY - globs only cover the path-shaped subset, not symptom/concept triggers
- Keep the index small: aim for <=15-20 entries. It loads eagerly every session, so a long flat index becomes its own attention drain. Past that, split by area into nested indexes rather than growing one list: each area's docs under `context/<area>/`, listed by a `context/<area>/index.md` that the root index lists (SKILL.md §Nested indexes)

## Anti-patterns

- Decorative Unicode (✓, ✗, →) - costs extra tokens, no information gain
- Prohibitions without alternatives - "Never X" alone is incomplete
- Tables for non-tabular data - use bullets
- Freedom-clauses ("the skill only enforces X") - restate the default loading mode
- Backslash-escaped markdown (`\*`, `\_`) - backtick the token instead
