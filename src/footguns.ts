import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  EXTERNAL_LABEL_RE,
  FOOTGUN_SECTION_RE,
  FOOTGUN_WORD_RE,
  GUARD_LABEL_RE,
  INVARIANT_LABEL_RE,
} from "./vocabulary";
import { loadIgnore, makeIsIgnored } from "./ignore";

// The DETERMINISTIC half of `audit`: lists every documented footgun in the corpus so the
// model can run each through the "prefer the fix over the note" ladder (root-cause fix >
// harness check > keep as an anchored doc). READ-ONLY - never writes.
//
// Categories, highest signal first:
//   A invariant-without-guard - an `invariant:` with no `enforce:`/`verify:` guard nearby
//                               (prime check candidate; you already called it an invariant)
//   D scriptable-procedure    - an ordered multi-command sequence agents must remember
//                               ("run X, then Y") - a script/hook that doesn't exist yet
//   B gotcha/pitfall section  - a bullet under a heading labeled gotcha/pitfall/caveat/...
//   C hazard phrase           - "silently", "passes ... but", "breaks if", "don't forget", ...

export type FootgunCategory = "A" | "B" | "C" | "D";

export interface Footgun {
  cat: FootgunCategory;
  category: string; // human label
  file: string;
  line: number;
  section: string;
  text: string;
}

export interface FootgunResult {
  scanned: number;
  total: number;
  byCategory: { A: number; B: number; C: number; D: number };
  findings: Footgun[];
}

export interface FootgunOptions {
  ignore?: string[];
}

const PRUNE = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  "out",
  ".cache",
  ".vercel",
  "worktrees",
]);

const CAT: Record<FootgunCategory, string> = {
  A: "invariant-without-guard",
  D: "scriptable-procedure",
  B: "gotcha-section",
  C: "hazard-phrase",
};
const RANK: Record<FootgunCategory, number> = { A: 0, D: 1, B: 2, C: 3 };
const GUARD_WINDOW = 6;

// Hazard word-class from the shared vocabulary + finder-specific hazard phrases.
const HAZARD_RE = new RegExp(
  FOOTGUN_WORD_RE.source +
    `|passes?\\b[^.!?]*\\bbut\\b|breaks?\\b\\s+(if|when|on)\\b|fails?\\b\\s+(silently|only|on|if|to)\\b` +
    `|\\b401s?\\b\\s+on\\b|don'?t\\s+forget|easy\\s+to\\s+(forget|miss|break)|watch\\s+out|bites?\\s+you\\b`,
  "i",
);

const excerpt = (s: string): string => {
  const t = s
    .replace(/^[\s>*-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > 140 ? t.slice(0, 137) + "..." : t;
};

// Strip inline-code spans so a doc that DISCUSSES `invariant:`/`enforce:` in backticks (e.g.
// this discipline's own meta-docs) isn't mistaken for a real labeled claim.
const bare = (l: string): string => l.replace(/`[^`]*`/g, " ");

// D scriptable-procedure: an ordered multi-command sequence agents must remember is a script
// (or hook) that doesn't exist yet - "run `oxfmt <paths>` first, then `git add` + `git commit`".
// Two signals must co-occur on one line, keeping the false-positive budget low:
//   1. >=2 inline-code spans that start with a known command runner, and
//   2. an ordering word in the surrounding prose (then/first/before/after/next/finally).
// A single command in backticks is a reference, not a procedure; two unordered ones are options.
// Arrows (`->`) are deliberately NOT ordering signals - repos use them as mapping notation
// ("feature -> development -> main"), which flooded the category with reference lines.
const COMMAND_SPAN_RE =
  /^(git|pnpm|npm|npx|yarn|bun|node|deno|make|cargo|go|docker|kubectl|helm|gh|terraform|bash|sh|cp|mv|rm|mkdir|curl|ssh|scp|rsync|psql|mysql|redis-cli|aws|gcloud|az|vault)\b/;
const ORDERING_RE = /\b(then|first|before|after|next|finally)\b/i;
const commandSpans = (l: string): number => {
  let n = 0;
  for (const m of l.matchAll(/`([^`]+)`/g)) {
    if (COMMAND_SPAN_RE.test(m[1].trim())) n++;
  }
  return n;
};
const isScriptableProcedure = (line: string, bareLine: string): boolean =>
  commandSpans(line) >= 2 && ORDERING_RE.test(bareLine);

function walk(
  root: string,
  dir: string,
  acc: string[],
  isIgnored: (rel: string) => boolean,
): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".claude" && e.name !== ".github")
      continue;
    const full = join(dir, e.name);
    const rel = relative(root, full).split("\\").join("/");
    if (isIgnored(rel)) continue;
    if (e.isDirectory()) {
      if (!PRUNE.has(e.name)) walk(root, full, acc, isIgnored);
    } else if (e.isFile()) {
      if (e.name === "CLAUDE.md") acc.push(full);
      else if (/(^|\/)context\/(?:[^/]+\/)*[^/]+\.md$/.test(rel) && e.name !== "index.md")
        acc.push(full);
    }
  }
  return acc;
}

function scan(root: string, file: string): Footgun[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const guardLines: number[] = [];
  lines.forEach((l, i) => {
    const tok = l.trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") return;
    // An explicit `external:` counts as acknowledged for category A - the
    // author already ran the ladder and concluded no in-repo guard is feasible.
    const b = bare(l);
    if (GUARD_LABEL_RE.test(b) || EXTERNAL_LABEL_RE.test(b)) guardLines.push(i);
  });
  const hasGuardNear = (i: number) =>
    guardLines.some((e) => Math.abs(e - i) <= GUARD_WINDOW);

  const perLine = new Map<
    number,
    { cat: FootgunCategory; section: string; text: string }
  >();
  let section = "";
  let isFootgunSection = false;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tok = line.trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      isFootgunSection = FOOTGUN_SECTION_RE.test(line);
      continue;
    }
    if (!line.trim()) continue;

    const bareLine = bare(line);
    let cat: FootgunCategory | null = null;
    if (
      INVARIANT_LABEL_RE.test(bareLine) &&
      !GUARD_LABEL_RE.test(bareLine) &&
      !EXTERNAL_LABEL_RE.test(bareLine) &&
      !hasGuardNear(i)
    )
      cat = "A";
    else if (isScriptableProcedure(line, bareLine)) cat = "D";
    else if (isFootgunSection && /^\s*[-*]\s+/.test(line)) cat = "B";
    else if (HAZARD_RE.test(bareLine)) cat = "C";
    if (!cat) continue;

    const prev = perLine.get(i);
    if (!prev || RANK[cat] < RANK[prev.cat]) {
      perLine.set(i, { cat, section, text: excerpt(line) });
    }
  }
  return [...perLine].map(([line, f]) => ({
    cat: f.cat,
    category: CAT[f.cat],
    section: f.section,
    text: f.text,
    file: relative(root, file).split("\\").join("/"),
    line: line + 1,
  }));
}

export function findFootguns(
  root: string,
  opts: FootgunOptions = {},
): FootgunResult {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  const isIgnored = makeIsIgnored(loadIgnore(root, opts.ignore));
  const files = walk(root, root, [], isIgnored);
  const findings: Footgun[] = [];
  for (const f of files) {
    try {
      findings.push(...scan(root, f));
    } catch {
      /* unreadable - skip */
    }
  }
  findings.sort(
    (a, b) =>
      RANK[a.cat] - RANK[b.cat] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
  const byCategory = { A: 0, B: 0, C: 0, D: 0 };
  for (const f of findings) byCategory[f.cat]++;
  return {
    scanned: files.length,
    total: findings.length,
    byCategory,
    findings,
  };
}
