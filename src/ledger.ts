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
 * signature. It lives in the repo's git common dir, so it is shared by every
 * worktree of the repo, survives across sessions, and can never be committed.
 * User corrections are NOT signatured: their wording varies too much for a
 * deterministic key, and the skill matches those against docs and handoffs.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { claudeProjectDir, gatherDigest, type GatherResult } from "./gather";

/** Lines that say what went wrong, in preference to the first line of output. */
const ERROR_LINE =
  /\b(error|fatal|not found|no such|denied|blocked|timed out|cannot|can't|failed|traceback|refused|unauthori[sz]ed|forbidden|no matches|not allowed|invalid)\b/i;

/** Framing that matches ERROR_LINE but never says what failed: markdown headers (MCP errors open with `### Error`) and stack traces. */
const FRAME_LINE = /^(#+ |traceback \(most recent call last\)|at |node:internal|file "|\^|throw )/i;

const MAX_SIGNATURE_CHARS = 120;

/**
 * Reduce a tool error to a stable signature, or null when nothing in it is
 * worth keying on.
 *
 * The same failure in two sessions differs in paths, ids, line numbers, pids and
 * quoted values; those are replaced with placeholders so the two collapse to one
 * key. A Bash failure opens with `Exit code N`, which says nothing - the first
 * line that names an error is the signal.
 */
export function signatureOf(error: string): string | null {
  const lines = error
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^exit code \d+$/i.test(l) && !FRAME_LINE.test(l));
  if (!lines.length) return null;
  const pick = lines.find((l) => ERROR_LINE.test(l)) ?? lines[0]!;
  const sig = pick
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/(?:~|\.{1,2})?\/[\w.@~+-]+(?:\/[\w.@~+-]*)+/g, "<path>")
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

/** Where the ledger lives for the repo containing `cwd`, or null outside a git repo. */
export function ledgerPath(cwd: string = process.cwd()): string | null {
  let common: string;
  try {
    common = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  const dir = isAbsolute(common) ? common : resolve(cwd, common);
  return join(dir, "context-index", "friction.jsonl");
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

export interface Sighting {
  signature: string;
  /** Distinct OTHER sessions that produced this signature before. */
  seenBefore: number;
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
    sightings.set(i, { signature: sig, seenBefore: [...sessions].filter((s) => s !== session).length });
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

/**
 * Seed the ledger from every past session filed under `cwd`'s project
 * directory, so the repetition gate works from the first reflect instead of
 * after weeks of accumulation. Returns the number of sessions read.
 */
export function backfillLedger(path: string, cwd: string = process.cwd()): number {
  let entries: string[];
  try {
    entries = readdirSync(claudeProjectDir(cwd));
  } catch {
    return 0;
  }
  let n = 0;
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".jsonl")) continue;
    const result = gatherDigest({ sessionId: entry.slice(0, -".jsonl".length), cwd });
    if (!result.transcript) continue;
    recordFriction(result, path);
    n++;
  }
  return n;
}
