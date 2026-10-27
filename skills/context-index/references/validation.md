# Validation

`context-index check` is the deterministic gate. Run it from the target repo and resolve every error before declaring done.

- Run: `context-index check` (scans the current repo; `--target <path>` for another).
- Autofix the one mechanical violation with `--fix` (relocates a misplaced `@context/index.md` import to the last line). Em dashes and smart typography are house style, so punctuation is never rewritten.
- Exit 0 = clean (warnings allowed); exit 1 = errors remain - keep fixing.
- `--quiet` prints only errors (warnings are still counted) - use it when wiring the check into a commit hook or CI.
- `--file <path>` reports findings for that doc only (repeatable); the whole corpus is still read, so cross-file checks stay correct. The doc-edit hook uses it.
- `--symbols` adds the dead-identifier check (below). It reads every tracked source file, so it is an audit aid, not a commit gate.
- Exclude foreign instruction files (legacy/demo/vendored `CLAUDE.md` the repo doesn't own): add literal paths (no globs) to a `.contextignore` at the repo root, one per line - e.g. `_legacy`, `expo/sports`. A bare name matches that dir/file at any depth; a path with a `/` anchors to the root and skips it plus anything beneath. Use `--ignore <a,b>` for one-offs. Ignore only files you don't author - never to silence real violations in your own corpus.

Scope: root `CLAUDE.md`, the index tree (`context/index.md` plus every `context/<area>/index.md` it lists), every `context/**/*.md`, colocated `**/CLAUDE.md`, and project skills under `.claude/skills/*/SKILL.md` and `.agents/skills/*/SKILL.md`, and Claude Code workflows under `.claude/workflows/`.

## Errors

- Orphaned topic docs and sub-indexes (anywhere under `context/`, listed by no index reachable from the root; matched by full path)
- Dangling `context/` pointers
- Identical-body duplicate docs
- Index entries missing a "Use when:" trigger or using an eager `@`
- Missing `@context/index.md` import
- Length over budget: lines (root 150, colocated 200, topic 200) or tokens (colocated ~5k, topic ~10k)

## Warnings (heuristic smells - review, don't blindly obey)

Load cost - what a session pays without asking for it:

- Always-loaded layer (root + index) over ~2.5k tokens
- Colocated CLAUDE.md over ~2.5k tokens, topic doc over ~5k
- A colocated CLAUDE.md whose ancestor stack (it plus every colocated CLAUDE.md above it) is over ~6k tokens - all of them load when a file in that directory is touched
- Prose lines over 400 chars in an auto-loaded file - a paragraph packed onto one line, so the line budget understates the file
- An index directive that reads ahead ("when in doubt", "always read") - every arguable trigger becomes eager
- A broad trigger ("navigating", "overview", "any task", "locating which package owns code") on a doc over ~1.5k tokens - it fires on nearly every task
- A skill description, or a workflow's `meta.description` + `meta.whenToUse`, over 500 chars; a SKILL.md over ~5k tokens (it loads whole on invocation and only its first ~5k survive a compaction)
- A skill/workflow listing over ~3k tokens: every visible project skill plus every `.claude/workflows/*.js` entry, at chars/3 + ~75 tokens per entry (measured: hiding six skills of 2,810 chars cut a Claude Code first request by 1,387 tokens). Skills hidden with `disable-model-invocation: true` are left out of the total and named; skills of plugins enabled in `.claude/settings.json` are listed too but live outside the repo, so they are named, not counted

Hygiene:

- Decorative status glyphs (✓✗); backslash-escaped markdown
- Fenced code block in CLAUDE.md/index (inlined snippet - link to source)
- External dangling pointers
- Length over the ideal; an index over the ~20-entry soft cap; an index listed twice or in a cycle
- Triggers sharing distinctive keywords (ambiguous routing); trigger keywords largely absent from their doc (stale/drift)
- Stale path-scoped glob (an entry's optional `; paths:` directory no longer exists)
- Dated state claim with no nearby anchor
- `## Commands` after `## Architecture`

Drift - prose that fell out of step with the repo or with a sibling doc:

- A backticked repo path that names nothing: not at the root, not next to the doc, not as a package-relative abbreviation (`services/x.ts` for `services/api/src/services/x.ts`), and not gitignored. Sentences that say the thing is gone ("there is no", "removed", "returns nothing", "generated") are skipped, as are templates (`<id>`, `*`, `path/to/`) and paths whose first segment is nowhere in this repo
- A rule sentence (10+ words) that another doc states word for word, ignoring markup - the copies drift apart. Sentences that point at a `context/` doc or a `CLAUDE.md` are skipped: a shared pointer is the fix, not the problem
- With `--symbols`: a backticked camelCase/PascalCase identifier that no tracked source file contains (renamed or removed - or another system's API name, so judge each)

## verify

`context-index verify` lists every `verify:` anchor; `--run` executes them and reports four outcomes (`references/anchored-claims.md`):

- Only read-only local pipelines run: each stage is `git grep`, `git ls-files`, `grep`, `ls`, `test`, `wc`, `sort`, `uniq`, `head`, `tail`, or `cut`, with no `;`, `&`, redirects, or substitutions. Anything else (`kubectl`, `curl`, `pnpm`, a script) is `unchecked` - run it by hand.
- `conform` / `drift` need an expectation the runner can read after the command: "returns nothing", "finds nothing", "no hits" (empty output), or `(0)` (every count zero). A verify with no such words is `unchecked` after it runs - write the expectation in when the claim is a negative.
- `broken`: the command itself failed - a file it names is gone. A missing gitignored file (an install or build artifact) is `unchecked`, not broken.
- Exit 1 on any drift or broken.

Tokens are estimated at 3 chars/token. Dense instruction markdown runs nearer 2.5, so real cost is usually a little higher than reported. For an exact figure, Claude Code's `/context` lists each loaded memory file.

## Does NOT catch - still your judgment

- Whether a flagged overlap/drift is real, and which copy of a duplicated rule should stay
- Paraphrased duplicates and stale claims that name no path or identifier (a wrong count, a changed behavior)
- Classification (universal vs colocated vs cross-cutting)
- Whether a skill is started by hand (hide it from the model) or by the model (keep its description)
- Subtle trigger staleness; prose-vs-bullets quality
