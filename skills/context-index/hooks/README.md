# inject-context hook (Claude Code, optional)

`inject-context.mjs` is a `PreToolUse` (Edit|Write) hook. When the agent edits a file matching an index entry's `; paths:` glob, it surfaces that topic doc's `## Inject` section (or its head) as additional context.

- Dormant by default: a no-op for any repo whose index tree has no `paths:` globs.
- Read-only and fail-safe: any error exits 0 and never blocks the edit.
- Claude Code only. Other agents ignore this directory.

## Wiring

The Claude Code plugin install (`/plugin install context-index@getsoel`) wires it for you.

If you installed the skill with `npx skills add`, add it to the repo's `.claude/settings.json`:

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
    ]
  }
}
```
