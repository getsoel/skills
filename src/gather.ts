/**
 * Build the digest `reflect` distills a session from. Claude Code transcripts only: other
 * agents keep no transcript in this shape, and the skill falls back to the live context.
 *
 * reflect's raw material is the conversation itself: the corrections, the
 * constraints, the "why" behind a decision. Its natural instinct is to read the
 * live context window — but after a compaction that window holds a SUMMARY, and
 * a summary drops exactly those things first. The transcript on disk is never
 * compacted, so it is the honest source.
 *
 * Reading it whole is not an option. A long session is megabytes of tool I/O
 * (measured: 4.6 MB across 1,600 lines) and slurping that back would re-flood
 * the very context a compaction just freed. So this extracts a slim digest —
 * human turns verbatim, assistant prose clipped, tool errors kept, everything
 * else dropped — which measured ~124x smaller on that same transcript.
 *
 * The digest is STREAMED TO THE CALLER AND NEVER PERSISTED: nothing here writes
 * anywhere.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Encode an absolute working-directory path into Claude Code's
 * `~/.claude/projects/<encoded>/` directory name: every non-alphanumeric
 * character becomes `-`. Mirrors Claude Code exactly.
 */
export function encodeProjectPath(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Root of Claude Code's per-project transcript directories. */
export function claudeProjectsRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/** Claude Code's transcript directory for a working directory. */
export function claudeProjectDir(absPath: string): string {
  return join(claudeProjectsRoot(), encodeProjectPath(absPath));
}

/** Top-level session transcripts for a working directory, most recently active first. */
function newestSession(cwd: string): { sessionId: string; transcript: string } | null {
  const dir = claudeProjectDir(cwd);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  let best: { sessionId: string; transcript: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const full = join(dir, entry);
    let mtime: number;
    try {
      mtime = statSync(full).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtime > best.mtime) {
      best = { sessionId: entry.slice(0, -".jsonl".length), transcript: full, mtime };
    }
  }
  return best && { sessionId: best.sessionId, transcript: best.transcript };
}

/**
 * Clip lengths. The asymmetry is the whole design: a human turn is short and is
 * the single highest-signal row in the file (it is where "actually, do it this
 * way" lives), so it is kept WHOLE. Assistant prose is long and reflect only
 * needs the claim, not the elaboration.
 */
const MAX_ASSISTANT_CHARS = 600;
const MAX_ERROR_CHARS = 400;

export type DigestKind = "user" | "assistant" | "error";

export interface DigestRow {
  kind: DigestKind;
  text: string;
  ts?: string;
}

export interface GatherStats {
  /** Transcript lines read. */
  lines: number;
  /** Rows surviving extraction, before dedup. */
  extracted: number;
  /** Rows collapsed as consecutive duplicates. */
  deduped: number;
  rawBytes: number;
  digestBytes: number;
}

export interface GatherResult extends ResolvedTranscript {
  rows: DigestRow[];
  stats: GatherStats;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Concatenate the `text` blocks of a message's content.
 *
 * A user turn's content is a bare string; an assistant turn's is an array of
 * blocks. Only `text` blocks are taken: `thinking` is enormous and `tool_use`
 * carries the input blob, and between them they are the bulk this function
 * exists to leave behind.
 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

/** The first errored tool_result in a content array, if any. */
function errorOf(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      !isRecord(block) ||
      block.type !== "tool_result" ||
      block.is_error !== true
    )
      continue;
    const body = block.content;
    return typeof body === "string" ? body : JSON.stringify(body);
  }
  return null;
}

/**
 * Reduce one transcript line to a digest row, or null to drop it.
 *
 * Exported for tests, and because the keep/drop policy IS the contract this
 * module publishes — `references/gather.md` in the reflect skill documents the
 * same table.
 *
 * A line that is not valid JSON is dropped, never thrown: transcripts are
 * appended to by a live process, so the final line can be a partial write, and
 * one torn line must not cost the caller the whole session.
 */
export function digestLine(raw: string): DigestRow | null {
  if (!raw.trim()) return null;

  let line: unknown;
  try {
    line = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(line)) return null;

  // Subagent turns. They belong to a different conversation with its own
  // arc, and folding them in would attribute a subagent's reasoning to the
  // session. Gathering those is a separate ask.
  if (line.isSidechain === true) return null;

  const ts = typeof line.timestamp === "string" ? line.timestamp : undefined;
  const message = isRecord(line.message) ? line.message : undefined;

  // The human's own words. `promptSource: "typed"` is the load-bearing field:
  // every other `user` line is a tool result, an injected reminder, or a
  // system-authored turn, and none of those are things the user said.
  if (line.type === "user" && line.promptSource === "typed") {
    const text = textOf(message?.content);
    return text ? { kind: "user", text, ts } : null;
  }

  if (line.type === "assistant") {
    const text = textOf(message?.content);
    return text
      ? { kind: "assistant", text: clip(text, MAX_ASSISTANT_CHARS), ts }
      : null;
  }

  // A failed TOOL CALL and what it said. Narrower than "the session's failures":
  // a command that exits non-zero inside Bash (a failing test, a `fatal:` from
  // git) returns a SUCCESSFUL tool_result and is dropped as bulk below. Observed
  // on a real session — several failed commands, exactly one is_error row, and it
  // was a tool rejection. Widening this means keeping successful tool output,
  // which is the bulk this digest exists to drop.
  if (line.type === "user") {
    const err = errorOf(message?.content);
    return err ? { kind: "error", text: clip(err, MAX_ERROR_CHARS), ts } : null;
  }

  // Everything else: `thinking`-only assistant turns, successful tool results,
  // and the non-conversation line types (ai-title, attachment,
  // file-history-snapshot, mode, permission-mode, last-prompt, system).
  return null;
}

/**
 * Collapse runs of identical rows.
 *
 * Claude Code can record the same turn twice — an opening prompt is written
 * once, then again a few seconds later, both as conversation roots
 * (`parentUuid: null`) with DIFFERENT uuids. So a uuid key cannot catch it
 * (a real transcript had zero duplicate uuids and a visibly duplicated prompt),
 * and content alone is too blunt: "yes" is a legitimate answer a user gives
 * many times in one session.
 *
 * Adjacency is what separates them. A re-recorded turn is immediately
 * consecutive — nothing was said in between. Two real "yes" turns always have
 * an assistant row between them, so they are never adjacent here and are never
 * collapsed.
 */
export function dedupe(rows: DigestRow[]): {
  rows: DigestRow[];
  removed: number;
} {
  const out: DigestRow[] = [];
  let removed = 0;
  for (const row of rows) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === row.kind && prev.text === row.text) {
      removed++;
      continue;
    }
    out.push(row);
  }
  return { rows: out, removed };
}

export interface ResolveOpts {
  /** Explicit session id; defaults to `$CLAUDE_CODE_SESSION_ID`. */
  sessionId?: string;
  /** Working directory whose project dir to search. Defaults to cwd. */
  cwd?: string;
}

export interface ResolvedTranscript {
  transcript: string | null;
  sessionId: string | null;
  /**
   * A session was named explicitly and has no transcript. Distinct from a plain
   * `transcript: null`, which means nothing was found to gather at all.
   */
  missing: boolean;
}

/**
 * Locate a session's transcript.
 *
 * A session id is globally unique, so it can be found without reproducing
 * Claude Code's cwd-to-directory encoding — which matters because a session
 * that changed directory, or one driving worktrees, is not necessarily filed
 * under the cwd it is running in now. The encoded dir is still tried FIRST
 * because it is a single stat instead of a scan.
 *
 * Only top-level `<session-id>.jsonl` files are considered. Subagent
 * transcripts nest under `<session>/subagents/` and are a different
 * conversation, deliberately not gathered here.
 */
export function resolveTranscript(opts: ResolveOpts = {}): ResolvedTranscript {
  const cwd = opts.cwd ?? process.cwd();
  // Whether the caller NAMED a session, as opposed to one being inferred from
  // the environment. The distinction decides whether falling back is honest.
  const explicit = opts.sessionId !== undefined;
  const sessionId =
    opts.sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;

  if (sessionId) {
    const direct = join(claudeProjectDir(cwd), `${sessionId}.jsonl`);
    if (existsSync(direct))
      return { transcript: direct, sessionId, missing: false };

    const root = claudeProjectsRoot();
    let dirs: string[];
    try {
      dirs = readdirSync(root);
    } catch {
      dirs = [];
    }
    for (const dir of dirs) {
      const candidate = join(root, dir, `${sessionId}.jsonl`);
      if (existsSync(candidate))
        return { transcript: candidate, sessionId, missing: false };
    }

    // A session the caller asked for BY NAME and that does not exist is an
    // answer, not a prompt to go find a different one. Falling back here
    // silently digested an unrelated conversation and reported success — the
    // caller would have distilled one session's lessons as another's.
    if (explicit) return { transcript: null, sessionId, missing: true };
  }

  // Inferred or absent id: the most recently active session for this directory
  // is the best guess, and the caller reports which transcript it used.
  const newest = newestSession(cwd);
  if (newest) return { ...newest, missing: false };

  return { transcript: null, sessionId, missing: false };
}

export interface GatherOpts extends ResolveOpts {
  /** Keep only the last N rows. 0 or undefined keeps everything. */
  limit?: number;
}

/**
 * Resolve, read, and digest a session transcript.
 *
 * Read whole rather than streamed: this runs once per reflect invocation on a
 * file measured in single-digit megabytes, and a byte-accurate reader would buy
 * nothing without a cursor to resume from.
 */
export function gatherDigest(opts: GatherOpts = {}): GatherResult {
  const { transcript, sessionId, missing } = resolveTranscript(opts);
  const empty: GatherStats = {
    lines: 0,
    extracted: 0,
    deduped: 0,
    rawBytes: 0,
    digestBytes: 0,
  };
  if (!transcript)
    return { transcript: null, sessionId, missing, rows: [], stats: empty };

  let raw: string;
  try {
    raw = readFileSync(transcript, "utf8");
  } catch {
    return { transcript, sessionId, missing, rows: [], stats: empty };
  }

  const lines = raw.split("\n");
  const extracted: DigestRow[] = [];
  for (const line of lines) {
    const row = digestLine(line);
    if (row) extracted.push(row);
  }

  const { rows: deduped, removed } = dedupe(extracted);
  const limited =
    opts.limit && opts.limit > 0 ? deduped.slice(-opts.limit) : deduped;

  return {
    transcript,
    sessionId,
    missing,
    rows: limited,
    stats: {
      lines: lines.length,
      extracted: extracted.length,
      deduped: removed,
      rawBytes: Buffer.byteLength(raw),
      digestBytes: limited.reduce(
        (n, r) => n + Buffer.byteLength(r.text) + 8,
        0,
      ),
    },
  };
}

const LABEL: Record<DigestKind, string> = {
  user: "USER",
  assistant: "ASST",
  error: "ERR ",
};

/** Render a digest for a reader — the form reflect actually reasons over. */
export function formatDigest(result: GatherResult): string {
  const out: string[] = [];
  for (const row of result.rows) {
    out.push(`${LABEL[row.kind]}  ${row.text}`);
    out.push("");
  }
  return out.join("\n");
}
