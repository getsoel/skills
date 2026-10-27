# Hooks (Claude Code, optional)

Two read-only, fail-safe hooks (any error exits 0; neither ever blocks an edit). Other agents ignore this directory.

- **`check-doc-edit.mjs`** - `PostToolUse` (Edit|Write). When the agent edits a `CLAUDE.md` or a doc under `context/`, it runs `context-index check --file` on that doc and returns the findings as additional context: a path that no longer exists, a rule another doc already states, a budget overrun, a dated claim with no anchor. Silent when the doc is clean. Most doc edits happen mid-task with the skill not loaded; this is what checks them.
- **`inject-context.mjs`** - `PreToolUse` (Edit|Write). When the agent edits a file matching an index entry's `; paths:` glob, it surfaces that topic doc's `## Inject` section (or its head) as additional context. Dormant by default: a no-op for any repo whose index tree has no `paths:` globs.

## Wiring

The Claude Code plugin install (`/plugin install context-index@getsoel`) wires both for you.

If you installed the skill with `npx skills add`, add them to the repo's `.claude/settings.json` (merge into an existing `hooks` block):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/skills/context-index/hooks/inject-context.mjs"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/skills/context-index/hooks/check-doc-edit.mjs"
          }
        ]
      }
    ]
  }
}
```

Adjust the path if the skill lives elsewhere (e.g. `.agents/skills/context-index`).
