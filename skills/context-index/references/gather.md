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

`ERR` is a failed TOOL CALL: a rejection, a hook block, an MCP error, and - in current Claude Code - a `Bash` command that exited non-zero (`Exit code 1 …`). Across 681 real sessions, 1,149 of 1,546 `ERR` rows were `Bash` exits. Not every one is friction: a test failing while you iterate is the intended signal. reflect sorts them (`references/reflect-heuristics.md` -> "Failed tool calls are friction too").

## Drop

- `thinking` blocks and `tool_use` inputs.
- Successful `tool_result` payloads. With the above, this is the bulk.
- `isSidechain:true` rows - a subagent is a different conversation, and folding it in attributes its reasoning to this session.
- The non-conversation line types: `ai-title`, `attachment`, `file-history-snapshot`, `mode`, `permission-mode`, `last-prompt`, `system`.

## Dedup

Consecutive identical rows collapse. Claude Code can record the same turn twice - an opening prompt written once, then again seconds later, both as conversation roots with DIFFERENT uuids, so a uuid key cannot catch it.

Adjacency is what makes this safe. A re-recorded turn is immediately consecutive; two genuine "yes" answers always have an assistant row between them, so they are never adjacent and never collapsed.

## Friction ledger

reflect's repetition gate needs to know whether a failure happened before, and one session cannot tell it. So `gather` normalizes each `ERR` row to a signature - paths, numbers, ids, tokens and quoted values replaced, stack framing skipped - and records which sessions produced it in a per-repo ledger.

- **One ledger per repo, not per checkout.** It is keyed on the normalized `origin` remote and kept at `~/.claude/context-index/ledgers/<host-org-repo>.jsonl`, so side-by-side clones and worktrees share it - on one team's repo, a per-clone ledger saw 199 of 689 sessions. A repo with no `origin` falls back to `<git common dir>/context-index/friction.jsonl`. Never inside the work tree, so never committed.
- **Repo problems only.** A user rejecting a tool call is a decision, and the agent harness's own preconditions (edit before read, a stale `old_string`) are not repo footguns - neither is recorded.
- **Annotates the digest.** An `ERR` row whose signature appeared in earlier sessions reads `[seen in N earlier sessions]`. `--json` adds a `friction` array with each row's signature and count.
- **Idempotent.** A signature is recorded once per session, so re-gathering never inflates a count.
- **Signatures only.** It stores the normalized one-line signature, never the digest or the transcript.
- `--backfill` seeds it from every past session of the repo - any clone or worktree, matched by the directory each session ran in - so the gate works from the first reflect. `--no-ledger` skips it.

User corrections are not signatured: their wording varies too much for a deterministic key. reflect checks those against existing docs and handoffs.

## What it does not do

The digest is streamed and never stored. The only write is the ledger's signature lines.

It reads Claude Code transcripts (`~/.claude/projects/`) only. In any other agent it reports no transcript, and reflect falls back to the live context and says the pass was degraded.
