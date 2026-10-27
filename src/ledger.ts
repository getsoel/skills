/**
 * The friction ledger: how reflect knows a failure is a pattern, not a one-off.
 *
 * reflect's repetition gate only proposes a fix for a problem seen in 2+ sessions.
 * A single reflect pass sees ONE session, so it cannot tell on its own - this
 * module gives it memory, deterministically, for the one kind of friction that
 * has a stable shape: failed tool calls.
 *
 * Each `ERR` row is normalized to a signature (paths, numbers, ids and quoted
 * values stripped), and the ledger records which sessions produced which
 * signature. It is keyed on the repo's `origin` remote and kept under
 * `~/.claude/context-index/ledgers/`, so every clone and worktree of the repo
 * shares one ledger (teams often run several clones side by side, and a per-clone
 * ledger would see a fraction of the sessions), it survives across sessions, and
 * it can never be committed. A repo with no `origin` falls back to its git
 * common dir, which worktrees still share.
 * User corrections are NOT signatured: their wording varies too much for a
 * deterministic key, and the skill matches those against docs and handoffs.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { claudeProjectsRoot, digestTranscript, type GatherResult } from "./gather";

/** Lines that say what went wrong, in preference to the first line of output. */
const ERROR_LINE =
  /\b(error|fatal|not found|no such|denied|blocked|timed out|cannot|can't|failed|traceback|refused|unauthori[sz]ed|forbidden|no matches|not allowed|invalid)\b/i;

/** Framing that matches ERROR_LINE but never says what failed: markdown headers (MCP errors open with `### Error`) and stack traces. */
const FRAME_LINE = /^(#+ |traceback \(most recent call last\)|at |node:internal|file "|\^|throw )/i;

/**
 * Failures that are never a repo footgun: the user declining a tool call (a
 * decision, not friction) and the agent harness's own preconditions (edit before
 * read, a stale old_string). Counting them would put "seen in 59 earlier
 * sessions" on noise and bury the repeats that point at something fixable.
 */
const HARNESS_NOISE =
  /doesn't want to proceed with this tool use|tool use was rejected|<tool_use_error>(string to replace not found|file has not been read yet|file has been modified since read|found \d+ matches of the string)/i;

const MAX_SIGNATURE_CHARS = 120;

/**
 * Reduce a tool error to a stable signature, or null when nothing in it is
 * worth keying on - including a user rejection or an agent-harness precondition.
 *
 * The same failure in two sessions differs in paths, ids, line numbers, pids and
 * quoted values; those are replaced with placeholders so the two collapse to one
 * key. A Bash failure opens with `Exit code N`, which says nothing - the first
 * line that names an error is the signal.
 */
export function signatureOf(error: string): string | null {
  if (HARNESS_NOISE.test(error)) return null;
  const lines = error
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^exit code \d+$/i.test(l) && !FRAME_LINE.test(l));
  if (!lines.length) return null;
  const pick = lines.find((l) => ERROR_LINE.test(l)) ?? lines[0]!;
  const sig = pick
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/(?<![\w.@~+-])(?:~|\.{1,2})?\/[\w.@~+-]+(?:\/[\w.@~+-]*)+/g, "<path>")
    .replace(/\b[\w.@~+-]+(?:\/[\w.@~+-]+)+\/?/g, "<path>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>")
    .replace(/\b[A-Za-z0-9+/_-]{24,}={0,2}/g, "<id>")
    .replace(/(["`]).*?\1/g, "<q>")
    .replace(/(^|[\s(=:])'[^']*'/g, "$1<q>")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
  return sig ? sig.slice(0, MAX_SIGNATURE_CHARS) : null;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * `git@github.com:Org/Repo.git`, `https://user@github.com/org/repo` and
 * `ssh://git@github.com/org/repo.git` all name one repo: reduce each to
 * `github.com/org/repo`.
 */
export function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(?!\d+\/)/, "$1/")
    .replace(/\.git\/?$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Where the ledger lives for the repo containing `cwd`, or null outside a git repo. */
export function ledgerPath(cwd: string = process.cwd()): string | null {
  const origin = git(cwd, ["remote", "get-url", "origin"]);
  if (origin) {
    const key = normalizeRemote(origin).replace(/[^a-z0-9.]+/g, "-");
    return join(homedir(), ".claude", "context-index", "ledgers", `${key}.jsonl`);
  }
  const common = git(cwd, ["rev-parse", "--git-common-dir"]);
  if (!common) return null;
  return join(isAbsolute(common) ? common : resolve(cwd, common), "context-index", "friction.jsonl");
}

interface LedgerEntry {
  sig: string;
  session: string;
  ts?: string;
}

function readLedger(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const out: LedgerEntry[] = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try {
      const e = JSON.parse(raw) as LedgerEntry;
      if (typeof e.sig === "string" && typeof e.session === "string") out.push(e);
    } catch {
      // A torn line from an interrupted append costs that one entry, never the ledger.
    }
  }
  return out;
}

/**
 * Source fixes asked of someone else (a change request) or not yet applied,
 * keyed by the signature they would retire. Without this a change request is
 * fire-and-forget, and the guard standing in for it quietly becomes permanent:
 * a pending fix lets the next reflect pass see "still recurring, fix not landed"
 * instead of reaching for another guard. Later lines win, so `resolved` clears.
 */
interface PendingLine {
  pending?: string;
  resolved?: string;
  fix?: string;
  ts?: string;
}

/** Normalize a signature or raw error text the way gather keys it. */
export function signatureKey(text: string): string {
  return signatureOf(text) ?? text.trim().toLowerCase();
}

export function pendingFixes(path: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    let line: PendingLine;
    try {
      line = JSON.parse(raw) as PendingLine;
    } catch {
      continue;
    }
    if (typeof line.pending === "string") out.set(line.pending, line.fix ?? "");
    else if (typeof line.resolved === "string") out.delete(line.resolved);
  }
  return out;
}

function appendLine(path: string, line: PendingLine): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(line) + "\n");
}

/** Record that `fix` (owner + change) would retire `signature`. Returns the normalized key. */
export function addPending(path: string, signature: string, fix: string): string {
  const key = signatureKey(signature);
  appendLine(path, { pending: key, fix, ts: new Date().toISOString() });
  return key;
}

/** Mark the pending fix for `signature` as landed. False when nothing was pending. */
export function resolvePending(path: string, signature: string): boolean {
  const key = signatureKey(signature);
  if (!pendingFixes(path).has(key)) return false;
  appendLine(path, { resolved: key, ts: new Date().toISOString() });
  return true;
}

export interface Sighting {
  signature: string;
  /** Distinct OTHER sessions that produced this signature before. */
  seenBefore: number;
  /** A recorded source fix for this signature that has not landed yet. */
  pending?: string;
}

/**
 * Annotate a gathered session's error rows with prior sightings, then record
 * this session's signatures.
 *
 * Idempotent per session: a (signature, session) pair is written once, so
 * re-running gather on the same session never inflates a count. A write
 * failure is swallowed - the ledger is an aid to judgment, and losing it must
 * never cost the caller the digest.
 */
export function recordFriction(result: GatherResult, path: string): Map<number, Sighting> {
  const sightings = new Map<number, Sighting>();
  const session = result.sessionId;
  if (!session) return sightings;

  const pending = pendingFixes(path);
  const prior = new Map<string, Set<string>>();
  for (const e of readLedger(path)) {
    if (!prior.has(e.sig)) prior.set(e.sig, new Set());
    prior.get(e.sig)!.add(e.session);
  }

  const fresh: LedgerEntry[] = [];
  result.rows.forEach((row, i) => {
    if (row.kind !== "error") return;
    const sig = signatureOf(row.text);
    if (!sig) return;
    const sessions = prior.get(sig) ?? new Set<string>();
    sightings.set(i, {
      signature: sig,
      seenBefore: [...sessions].filter((s) => s !== session).length,
      ...(pending.has(sig) ? { pending: pending.get(sig) } : {}),
    });
    if (!sessions.has(session)) {
      sessions.add(session);
      prior.set(sig, sessions);
      fresh.push({ sig, session, ts: row.ts });
    }
  });

  if (fresh.length) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, fresh.map((e) => JSON.stringify(e)).join("\n") + "\n");
    } catch {
      // Read-only git dir or similar: the digest still stands.
    }
  }
  return sightings;
}

/** The working directory a transcript was recorded in, from its first lines that carry one. */
function transcriptCwd(path: string): string | null {
  let head: string;
  try {
    head = readFileSync(path, "utf8").slice(0, 64_000);
  } catch {
    return null;
  }
  for (const raw of head.split("\n")) {
    try {
      const line = JSON.parse(raw) as { cwd?: unknown };
      if (typeof line.cwd === "string") return line.cwd;
    } catch {
      // A partial line at the slice boundary.
    }
  }
  return null;
}

/**
 * Seed the ledger from every past session of this repo - in any clone or
 * worktree, wherever Claude Code filed it - so the repetition gate works from
 * the first reflect instead of after weeks of accumulation. A session belongs
 * to the repo when the directory it ran in resolves to this ledger. Returns
 * the number of sessions read.
 */
export function backfillLedger(path: string): number {
  let dirs: string[];
  try {
    dirs = readdirSync(claudeProjectsRoot());
  } catch {
    return 0;
  }
  const owner = new Map<string, string | null>();
  let n = 0;
  for (const dir of dirs.sort()) {
    let entries: string[];
    try {
      entries = readdirSync(join(claudeProjectsRoot(), dir));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith(".jsonl")) continue;
      const transcript = join(claudeProjectsRoot(), dir, entry);
      const cwd = transcriptCwd(transcript);
      if (!cwd) continue;
      if (!owner.has(cwd)) owner.set(cwd, existsSync(cwd) ? ledgerPath(cwd) : null);
      if (owner.get(cwd) !== path) continue;
      recordFriction(digestTranscript(transcript, entry.slice(0, -".jsonl".length)), path);
      n++;
    }
  }
  return n;
}
