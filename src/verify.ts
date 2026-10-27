// Run the corpus's `verify:` anchors - the one-liners that re-prove a drift-prone claim - and
// report conform / drift / broken / unchecked (references/anchored-claims.md). Only read-only
// local commands run, and only an expectation a machine can read (empty, zero) is asserted;
// everything else is reported unchecked, never passed.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

export type VerifyOutcome = "conform" | "drift" | "broken" | "unchecked";

export interface VerifyResult {
  file: string;
  line: number;
  command: string;
  expect: "empty" | "zero" | null;
  outcome: VerifyOutcome;
  /** Why it was not run, or the first lines of output / error that decided it. */
  detail: string;
}

// `verify:` then a backticked command, with or without backticks around the label.
const ANCHOR = /verify:`?\s*`([^`]+)`([^`]{0,80})/g;
const EMPTY = /\b(?:returns nothing|finds nothing|prints nothing|no hits|no matches?|is empty)\b/i;
const ZERO = /^\s*(?:\(0\)|->\s*0\b|=\s*0\b|returns 0\b|prints 0\b)/i;

// The first program of each pipeline stage. A command runs only when every stage is one of
// these, so a verify line can read the repo but never change it, reach a network, or spawn
// another shell.
const READ_ONLY = /^(?:git (?:grep|ls-files)|grep|ls|test|wc|sort|uniq|head|tail|cut)\b/;
const UNSAFE = /[;&<>`]|\$\(|\$\{|\|\|/;
const TIMEOUT_MS = 10_000;

function expectation(rest: string): VerifyResult["expect"] {
  if (EMPTY.test(rest)) return "empty";
  if (ZERO.test(rest)) return "zero";
  return null;
}

/** Why a command may not run here, or null when it may. */
export function refuseReason(command: string): string | null {
  if (UNSAFE.test(command)) return "uses shell syntax beyond a plain pipe";
  for (const stage of command.split("|")) {
    if (!READ_ONLY.test(stage.trim())) return `\`${stage.trim().split(/\s+/)[0]}\` is not on the read-only list`;
  }
  return null;
}

/** Every `verify:` anchor in the given docs, run where it is safe to. */
export function runVerifies(root: string, files: string[], opts: { run?: boolean } = {}): VerifyResult[] {
  const out: VerifyResult[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const m of text.matchAll(ANCHOR)) {
        const command = m[1]!.trim();
        const expect = expectation(m[2] ?? "");
        const base = { file: relative(root, file), line: i + 1, command, expect };
        const refused = refuseReason(command);
        if (refused) { out.push({ ...base, outcome: "unchecked", detail: refused }); continue; }
        if (!opts.run) { out.push({ ...base, outcome: "unchecked", detail: "not run (pass --run)" }); continue; }
        out.push({ ...base, ...execute(root, command, expect) });
      }
    });
  }
  return out;
}

function isGitIgnored(root: string, path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", path.replace(/\/$/, "")], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function execute(root: string, command: string, expect: VerifyResult["expect"]): Pick<VerifyResult, "outcome" | "detail"> {
  let stdout = "";
  let code = 0;
  let stderr = "";
  try {
    stdout = execFileSync("sh", ["-c", command], {
      cwd: root,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string; signal?: string };
    if (e.signal) return { outcome: "unchecked", detail: `timed out after ${TIMEOUT_MS / 1000}s` };
    code = e.status ?? 2;
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }
  const head = (s: string) => s.trim().split("\n").slice(0, 3).join(" | ").slice(0, 200);
  // grep/git grep exit 1 = no match (an answer); 2+ = the command itself failed - a missing
  // file or bad pathspec means the anchor has drifted along with the doc.
  if (code >= 2 || (code === 1 && stderr.trim())) {
    // A file that only exists after an install or build (node_modules, ios/) is missing from
    // this checkout, not from the repo - the anchor could not be checked here.
    const gone = [...stderr.matchAll(/(\S+): No such file or directory/g)].map((m) => m[1]!.replace(/^\w+: /, ""));
    if (gone.length && gone.every((p) => isGitIgnored(root, p))) {
      return { outcome: "unchecked", detail: `needs an untracked file: ${gone[0]}` };
    }
    return { outcome: "broken", detail: head(stderr || stdout) || `exit ${code}` };
  }
  const output = stdout.trim();
  if (expect === "empty") return output ? { outcome: "drift", detail: head(output) } : { outcome: "conform", detail: "" };
  if (expect === "zero") {
    const counts = output.split("\n").map((l) => Number(l.split(":").pop()!.trim()));
    const zero = !output || counts.every((n) => n === 0);
    return zero ? { outcome: "conform", detail: "" } : { outcome: "drift", detail: head(output) };
  }
  return { outcome: "unchecked", detail: "ran; the doc states no machine-readable expectation" };
}
