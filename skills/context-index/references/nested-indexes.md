# Nested indexes, scaffolding, path-scoped activation

## Nested indexes

Past ~20 root entries, split the index by area instead of growing one list - every root entry is paid for on every task.

- Layout: move an area's docs into `context/<area>/`, list them in `context/<area>/index.md` (same bare-path + "Use when:" format), and replace their root entries with ONE entry for the sub-index whose trigger unions the area's routing keywords.
- Only the root index loads eagerly. A sub-index is read when its root trigger fires, then its own triggers route to the doc - two hops, so keep each area coherent enough for one root trigger to name it.
- Entry paths stay repo-relative (`context/<area>/<doc>.md`) at every level.
- `context-index check` walks the tree: every sub-index gets the entry rules plus its own soft cap and overlap check, and a doc or sub-index that no reachable index lists is an orphan.
- Moving a doc changes its path: rewrite every reference (code comments, skills, CI, other docs) in the same change. The validator proves index entries resolve, not prose pointers.

## Scaffolding

Create new topic docs by construction, not by hand - `context-index scaffold` generates the file skeleton AND the index entry together, so the wiring (bare path, "Use when:" trigger, no orphan, no dangling pointer) cannot drift.

- Run: `context-index scaffold <name> "<Use-when trigger>"` (`--target <path>` to target another repo, `--no-check` to skip the validator run).
- It normalizes the name to the single-word/hyphenated form, refuses if the file or an index entry already exists, inserts the entry grouped with existing `context/` entries, then runs the validator.
- Fill in the body after - never hand-edit `context/index.md` to add an entry the command would wire correctly.
- In a nested corpus, pass `--in <area>` to create `context/<area>/<name>.md` and wire it into `context/<area>/index.md` instead of the root. The area index must already exist and be listed from a parent index.

## Path-scoped activation (optional)

An index entry may append `; paths: \`<glob>\`, \`<glob>\`` after its trigger to deterministically match files (Cursor `globs`-style). The prose trigger stays PRIMARY - globs only cover the path-shaped subset. In Claude Code, the optional `hooks/inject-context.mjs` `PreToolUse` hook surfaces that doc's `## Inject` section (or head) when a matching file is edited - the Claude Code plugin install wires it; see `hooks/README.md` to wire it by hand. Absent `paths:` globs, the hook is a no-op - it is opt-in by index authoring. Other agents ignore the hook; the globs still document scope.

## Module recommendations

During reflect, when you find learnings scoped to a set of related files that share no common directory, recommend extracting those files into their own module/directory - it unlocks colocation. Present it as a recommendation, not an action: name the proposed directory, list the files, explain the colocation benefit. The user decides whether to restructure. Don't recommend extraction for only 1-2 files, for files already colocated, or where it fights framework conventions (e.g. Next.js `app/` routing).
