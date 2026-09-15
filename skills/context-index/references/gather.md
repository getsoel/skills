# Gather: the extraction contract

What `context-index gather` keeps, what it drops, and why. reflect reasons over the digest this produces; it never reads a transcript itself.

## Why the transcript and not the context window

reflect's raw material is the conversation: the corrections, the constraints, the "why" behind a decision. Its instinct is to scan the live context window - but after a compaction that window holds a SUMMARY, and a summary drops exactly those things first. A session that compacted mid-way will silently under-report, and the pass will look like it succeeded.

The transcript on disk is never compacted. It is the honest source.

## Why a digest and not the file

A long session is megabytes of tool I/O - one measured real transcript was 4.6 MB across 1,600 lines. Reading that back would re-flood the very context a compaction just freed. The digest of that same transcript was 170 rows and ~134x smaller.

So: run the command, reason over its output. Never `Read` a `.jsonl` transcript directly.

## Resolution

By session id, which is globally unique - so it needs no reproduction of Claude Code's cwd-to-directory encoding. That matters because a session that changed directory, or one driving worktrees, is not necessarily filed under the directory it is running in now.

- Default: `$CLAUDE_CODE_SESSION_ID`.
- `--session <id>` to name one explicitly. A named session that does not exist is an ERROR, never a fall-back to a different one.
- Neither: the most recently active session for the working directory.

Only top-level `<session-id>.jsonl` files are considered. Subagent transcripts nest under `<session>/subagents/` and are a different conversation - gathering those is a separate ask.

## Keep

| Row | Line shape | Treatment |
| --- | --- | --- |
| `USER` | `type:"user"` **and** `promptSource:"typed"` | **verbatim, never clipped** |
| `ASST` | `type:"assistant"`, `content[].type=="text"` | clipped to ~600 chars |
| `ERR` | a `tool_result` block with `is_error:true` | clipped to ~400 chars |

`promptSource:"typed"` is the load-bearing field: every other `user` line is a tool result, an injected reminder, or a system-authored turn, and none of those are things the user said. The human's turns are the highest-signal rows in the file - they are where "actually, do it this way" lives - which is why they alone survive whole.

`ERR` is NARROWER than "the session's failures". `is_error:true` marks the TOOL CALL failing - a rejected or errored tool use. A command that merely exits non-zero inside `Bash` (a failing test, a build error, a `fatal:` from git) returns a SUCCESSFUL `tool_result`, so it is dropped as bulk and never becomes an `ERR` row. Observed: a session with several failed commands and hook blocks produced exactly one `ERR`, and it was a tool rejection. Do not read an absence of `ERR` rows as a session that went smoothly - widening this would mean keeping successful tool output, which is the bulk this digest exists to drop.

## Drop

- `thinking` blocks and `tool_use` inputs.
- Successful `tool_result` payloads. With the above, this is the bulk.
- `isSidechain:true` rows - a subagent is a different conversation, and folding it in attributes its reasoning to this session.
- The non-conversation line types: `ai-title`, `attachment`, `file-history-snapshot`, `mode`, `permission-mode`, `last-prompt`, `system`.

## Dedup

Consecutive identical rows collapse. Claude Code can record the same turn twice - an opening prompt written once, then again seconds later, both as conversation roots with DIFFERENT uuids, so a uuid key cannot catch it.

Adjacency is what makes this safe. A re-recorded turn is immediately consecutive; two genuine "yes" answers always have an assistant row between them, so they are never adjacent and never collapsed.

## What it does not do

The digest is streamed and never stored - nothing in this path writes anywhere.

It reads Claude Code transcripts (`~/.claude/projects/`) only. In any other agent it reports no transcript, and reflect falls back to the live context and says the pass was degraded.
