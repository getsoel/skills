// context-index: the deterministic half of the context-index skill. Bundled to
// skills/context-index/scripts/context-index.mjs so any agent can run it with plain Node -
// no install, no dependencies.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { checkContext, corpusDocs, loadIndexTree } from "./check";
import { findFootguns } from "./footguns";
import { formatDigest, gatherDigest } from "./gather";
import { addPending, backfillLedger, ledgerPath, pendingFixes, recordFriction, resolvePending } from "./ledger";
import { scaffoldTopic } from "./scaffold";
import { runVerifies, type VerifyOutcome } from "./verify";

const USAGE = `usage: context-index <command> [options]

Commands:
  ls                     List the index tree (path + trigger; sub-index entries indented)
  check                  Validate the CLAUDE.md + context/index.md corpus (exit 1 on error)
                           [--fix] relocate a misplaced @context/index.md import
                           [--ignore <a,b>] skip foreign paths (also reads .contextignore)
                           [--quiet] print errors only (for commit hooks and CI)
                           [--file <path>] report findings for this doc only (repeatable)
                           [--symbols] also flag backticked identifiers no source file contains
  verify                 List the corpus's verify: anchors; --run executes the read-only ones and
                         reports conform / drift / broken / unchecked (exit 1 on drift or broken)
  scaffold <name> "<Use when trigger>"
                         New topic doc + wired index entry [--in <area>] [--no-check]
  footguns               Documented footguns to triage into fixes/checks [--limit N]
  gather                 Digest a Claude Code session transcript [--session <id>] [--limit N]
                         Records failure signatures in the repo's friction ledger [--no-ledger]; --backfill seeds it from past sessions
  ledger pending <signature> <fix>   Record a source fix not yet landed (gather then marks the failure)
  ledger resolve <signature>         Mark it landed
  ledger list                        Pending source fixes

Options:
  --target <path>        Repo to operate on (default: the git toplevel of the cwd)
  --json                 Machine-readable output (ls, check, footguns, gather, ledger list)`;

// Flags that consume the next argument. Everything else starting with -- is a boolean.
const VALUE_FLAGS = new Set(["--target", "--ignore", "--in", "--limit", "--session", "--file"]);

interface Args {
  positionals: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a : a.slice(0, eq);
    let value = eq === -1 ? "" : a.slice(eq + 1);
    if (eq === -1 && VALUE_FLAGS.has(name)) {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${name} needs a value`);
      value = next;
      i++;
    }
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { positionals, flags };
}

const flag = (args: Args, name: string): string | undefined => args.flags.get(name)?.at(-1);
const has = (args: Args, name: string): boolean => args.flags.has(name);
const list = (args: Args, name: string): string[] =>
  (args.flags.get(name) ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);

// The CHECKOUT's root, not the main repo's: a corpus is per-worktree. Outside git, the cwd.
function resolveRoot(target?: string): string {
  const start = resolve(target ?? process.cwd());
  let root = start;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || start;
  } catch {
    // not a git checkout (or no git) - scan from where we were pointed
  }
  return existsSync(root) ? realpathSync(root) : root;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function runLs(root: string, json: boolean): void {
  const entries = loadIndexTree(root);
  if (json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log("(no context/index.md entries)");
    return;
  }
  for (const e of entries) {
    console.log(`  ${"  ".repeat(e.depth)}${e.path}${e.trigger ? `  - ${e.trigger}` : ""}`);
  }
  const indexes = new Set(entries.map((e) => e.index)).size;
  console.log(`\n${plural(entries.length, "entry", "entries")}${indexes > 1 ? ` across ${indexes} indexes` : ""}`);
}

function runCheck(root: string, args: Args, json: boolean): void {
  const fix = has(args, "--fix");
  const result = checkContext(root, {
    fix,
    ignore: list(args, "--ignore"),
    symbols: has(args, "--symbols"),
    only: list(args, "--file"),
  });
  const errs = result.findings.filter((f) => f.sev === "error").length;
  const warns = result.findings.length - errs;
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (fix && result.fixed > 0) console.log(`Applied ${plural(result.fixed, "autofix", "autofixes")}.`);
    if (result.ignored.files + result.ignored.dirs > 0) {
      console.log(`Ignored ${result.ignored.files} file(s) and ${result.ignored.dirs} path(s) via .contextignore / --ignore.`);
    }
    // --quiet keeps the gate's output to what blocks it; warnings are still counted below.
    const shown = has(args, "--quiet") ? result.findings.filter((f) => f.sev === "error") : result.findings;
    const sorted = [...shown].sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1);
    for (const f of sorted) {
      console.log(`  ${f.sev === "error" ? "ERROR" : "warn "} ${f.file}${f.line ? `:${f.line}` : ""}  ${f.msg}`);
    }
    console.log(
      `\n${plural(result.entries, "index entry", "index entries")}${result.indexes > 1 ? ` across ${result.indexes} indexes` : ""}; ${errs} error(s), ${warns} warning(s)`,
    );
    if (errs > 0 && !fix) {
      console.log("Run with --fix to auto-correct mechanical violations, then resolve the rest by hand.");
    }
  }
  if (errs > 0) process.exitCode = 1;
}

function runVerify(root: string, args: Args, json: boolean): void {
  const results = runVerifies(root, corpusDocs(root, list(args, "--ignore")), { run: has(args, "--run") });
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const counts: Record<VerifyOutcome, number> = { conform: 0, drift: 0, broken: 0, unchecked: 0 };
    for (const r of results) counts[r.outcome]++;
    for (const r of results.filter((r) => r.outcome === "drift" || r.outcome === "broken")) {
      console.log(`  ${r.outcome.padEnd(6)} ${r.file}:${r.line}  ${r.command}
           -> ${r.detail}`);
    }
    console.log(
      `\n${plural(results.length, "verify anchor", "verify anchors")}: ${counts.conform} conform, ${counts.drift} drift, ${counts.broken} broken, ${counts.unchecked} unchecked`,
    );
    if (!has(args, "--run")) console.log("Nothing was run. Pass --run to execute the read-only ones.");
    else if (counts.unchecked) console.log("Unchecked = not read-only, or the doc states no empty/zero expectation: run those by hand.");
  }
  if (results.some((r) => r.outcome === "drift" || r.outcome === "broken")) process.exitCode = 1;
}

function runScaffold(root: string, args: Args): void {
  const [name, trigger] = args.positionals.slice(1);
  if (!name || !trigger) {
    throw new Error('usage: context-index scaffold <name> "<Use when trigger>" [--in <area>] [--no-check]');
  }
  const res = scaffoldTopic(root, name, trigger, { area: flag(args, "--in") });
  if (res.normalized) console.log(`Normalized name -> "${res.name}" (single-word, lowercase, hyphenated).`);
  console.log(`Created ${res.topicRel}`);
  console.log(`Added entry to ${res.indexRel}: ${res.entryLine}`);
  if (has(args, "--no-check")) {
    console.log("Skipped validator (--no-check). Run `context-index check` before done.");
    return;
  }
  const errors = checkContext(root).findings.filter((f) => f.sev === "error");
  if (errors.length > 0) {
    console.log("\nValidator errors remain - the new file is written; resolve them before done:");
    for (const f of errors) console.log(`  ERROR ${f.file}${f.line ? `:${f.line}` : ""}  ${f.msg}`);
    process.exitCode = 1;
  } else {
    console.log("\nValidator clean. Fill in the body, then re-run `context-index check`.");
  }
}

function parseLimit(args: Args, fallback: number): number {
  const raw = flag(args, "--limit");
  return raw === undefined ? fallback : Math.max(0, parseInt(raw, 10) || 0);
}

function runFootguns(root: string, args: Args, json: boolean): void {
  const limit = parseLimit(args, 40);
  const result = findFootguns(root, { ignore: list(args, "--ignore") });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Scanned ${result.scanned} file(s) under ${root}`);
  console.log(
    `Found ${result.total} documented footgun(s): ` +
      `A(invariant-no-guard)=${result.byCategory.A}  D(scriptable-procedure)=${result.byCategory.D}  B(gotcha-section)=${result.byCategory.B}  C(hazard-phrase)=${result.byCategory.C}`,
  );
  if (!result.total) return;
  console.log('\nRun each through the "prefer the fix over the note" ladder: root-cause fix > harness check > keep as an anchored doc.');
  const byFile = new Map<string, number>();
  for (const f of result.findings) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
  console.log("\nTop files:");
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(n).padStart(3)}  ${f}`);
  }
  for (const c of ["A", "D", "B", "C"] as const) {
    const all = result.findings.filter((f) => f.cat === c);
    if (!all.length) continue;
    const shown = limit ? all.slice(0, limit) : all;
    console.log(`\n[${c}] ${shown[0]!.category} - ${all.length} finding(s)${limit && all.length > limit ? ` (showing ${shown.length})` : ""}`);
    for (const f of shown) console.log(`  ${f.file}:${f.line}  ${f.text}`);
  }
}

function runGather(args: Args, json: boolean): void {
  // cwd is deliberately NOT the repo root: Claude Code files a transcript under the directory
  // it is running in, which for a session driving worktrees is not the root. Resolution falls
  // back to a session-id scan anyway, so this only picks the fast path.
  const ledger = has(args, "--no-ledger") ? null : ledgerPath();
  if (has(args, "--backfill")) {
    if (!ledger) throw new Error("--backfill needs a git repo (the ledger is keyed on it)");
    console.log(`Backfilled the friction ledger from ${backfillLedger(ledger)} session(s): ${ledger}`);
    return;
  }
  const result = gatherDigest({ sessionId: flag(args, "--session"), limit: parseLimit(args, 0) });
  const seen = ledger && result.transcript ? recordFriction(result, ledger) : new Map();
  if (json) {
    console.log(JSON.stringify({ ...result, friction: [...seen].map(([row, s]) => ({ row, ...s })) }, null, 2));
    return;
  }
  if (!result.transcript) {
    // A session named explicitly and absent is a usage error - loudly, so it can never be
    // mistaken for "this session had nothing to say".
    if (result.missing) throw new Error(`no transcript for session "${result.sessionId}"`);
    // Exit 0 on purpose: "nothing to gather" tells the caller to fall back, not to stop.
    console.log("No Claude Code transcript found ($CLAUDE_CODE_SESSION_ID is unset and this directory has no sessions).");
    console.log("Fall back to scanning the live context - degraded: a compacted session under-reports.");
    return;
  }
  const s = result.stats;
  const ratio = s.digestBytes > 0 ? Math.round(s.rawBytes / s.digestBytes) : 0;
  console.log(`# ${result.transcript}`);
  console.log(`# ${s.lines} line(s) -> ${result.rows.length} row(s); ${s.deduped} duplicate(s) collapsed; ${ratio}x smaller than raw\n`);
  console.log(formatDigest(result, seen));
}

function runLedger(args: Args, json: boolean): void {
  const [, verb, signature, fix] = args.positionals;
  const ledger = ledgerPath();
  if (!ledger) throw new Error("ledger needs a git repo (the ledger is keyed on it)");
  if (verb === "pending") {
    if (!signature || !fix) throw new Error('usage: context-index ledger pending "<signature>" "<fix and owner>"');
    console.log(`pending: ${addPending(ledger, signature, fix)}`);
  } else if (verb === "resolve") {
    if (!signature) throw new Error('usage: context-index ledger resolve "<signature>"');
    if (!resolvePending(ledger, signature)) throw new Error(`no pending fix for "${signature}"`);
    console.log("resolved");
  } else if (verb === "list" || verb === undefined) {
    const pending = [...pendingFixes(ledger)].map(([sig, fix]) => ({ signature: sig, fix }));
    if (json) console.log(JSON.stringify(pending, null, 2));
    else if (!pending.length) console.log("No pending source fixes.");
    else for (const p of pending) console.log(`${p.signature}\n    -> ${p.fix}`);
  } else {
    throw new Error(`unknown ledger verb "${verb}" (pending | resolve | list)`);
  }
}

export function main(argv: string[]): void {
  const args = parseArgs(argv);
  const cmd = args.positionals[0];
  const json = has(args, "--json");
  if (cmd === undefined || cmd === "help" || has(args, "--help")) {
    console.log(USAGE);
    return;
  }
  if (cmd === "gather") return runGather(args, json);
  if (cmd === "ledger") return runLedger(args, json);
  const root = resolveRoot(flag(args, "--target"));
  switch (cmd) {
    case "ls":
      return runLs(root, json);
    case "check":
      return runCheck(root, args, json);
    case "scaffold":
      return runScaffold(root, args);
    case "footguns":
      return runFootguns(root, args, json);
    case "verify":
      return runVerify(root, args, json);
    default:
      throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
  }
}
