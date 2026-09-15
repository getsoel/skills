import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { globStaticPrefix } from "./glob";
import { isIndexPath, parseIndexEntries, type IndexEntry } from "./index-entry";
import { ANCHOR_LABEL_RE } from "./vocabulary";
import { loadIgnore, makeIsIgnored } from "./ignore";

export interface ContextFinding {
  file: string;
  line: number;
  sev: "error" | "warn";
  msg: string;
}

export interface ContextOptions {
  /** Rewrite the mechanical violations that are safe to automate (currently: relocate a
   * misplaced `@context/index.md` import to the last line). House-style-neutral - it never
   * touches punctuation - em dashes and smart quotes are a house-style choice, not a defect. */
  fix?: boolean;
  /** Extra literal paths to skip, on top of `.contextignore` at the root. */
  ignore?: string[];
}

export interface ContextResult {
  findings: ContextFinding[];
  /** Entries across every index reached from context/index.md. */
  entries: number;
  /** Index files reached from context/index.md, the root included. */
  indexes: number;
  /** Number of autofixes written (0 unless `fix`). */
  fixed: number;
  /** How much the ignore-list pruned, for an honest "we skipped N" line. */
  ignored: { files: number; dirs: number };
}

type Kind = "root" | "colocated" | "index" | "topic" | "skip" | "other";
type AddFn = (file: string, line: number, sev: "error" | "warn", msg: string) => void;

const PRUNE = new Set([
  "node_modules", ".git", ".next", ".turbo", "dist", "build", "coverage", "out", ".cache", ".vercel", "worktrees",
]);

const BUDGET: Record<string, { warn: number; err: number }> = {
  root: { warn: 100, err: 150 },
  colocated: { warn: 150, err: 200 },
  topic: { warn: 150, err: 200 },
};

const INDEX_SOFT_MAX = 20;

// Approx tokens (chars/4) for the always-loaded layer (root CLAUDE.md + eager index).
const ALWAYS_LOADED_TOKEN_WARN = 2500;

// Style hygiene is deliberately light: em dashes and smart typography are a repo's own
// house-style choice, so only genuinely decorative status glyphs are flagged, and only as a
// warning - never failing the gate.
const DECORATIVE: Array<{ re: RegExp; name: string }> = [
  { re: /[✓✗✅❌]/g, name: "decorative check/cross glyph" },
];

// Low-signal words ignored when comparing triggers: generic verbs/nouns that recur across
// triggers carry no routing signal.
const STOP = new Set([
  "use", "when", "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "from", "by", "its", "it", "this", "that", "into", "out", "at", "any", "new", "via", "per",
  "adding", "editing", "working", "writing", "using", "creating", "modifying", "touching",
  "changing", "running", "seeing", "making", "setting", "checking", "updating", "handling",
  "calling", "add", "edit", "run", "file", "files", "page", "pages", "code", "data",
]);

// A dated state claim in prose ("verified 2026-06-22") rots silently; per the anchored-claims
// doctrine it should ride an anchor or be a check's output, not the doc.
const STATE_VERB = /\b(verified|re-verified|confirmed|last (?:verified|checked)|as of)\b/i;
const ISO_DATE = /\b\d{4}-\d{2}(?:-\d{2})?\b/;
const ANCHOR_WINDOW = 6;

interface Seg {
  code: boolean;
  text: string;
}

// Split a line into segments, marking inline-code spans so checks skip them.
function segments(line: string): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf("`", i);
    if (tick === -1) { out.push({ code: false, text: line.slice(i) }); break; }
    if (tick > i) out.push({ code: false, text: line.slice(i, tick) });
    const end = line.indexOf("`", tick + 1);
    if (end === -1) { out.push({ code: false, text: line.slice(tick) }); break; }
    out.push({ code: true, text: line.slice(tick, end + 1) });
    i = end + 1;
  }
  return out;
}

const prose = (line: string): string => segments(line).filter((s) => !s.code).map((s) => s.text).join("");

// Distinctive keywords from a trigger (lowercased tokens len>=3, minus stopwords).
function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z0-9][a-z0-9_./+-]{2,}/g) ?? []) {
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

function approxTokens(file: string): number {
  try { return Math.round(readFileSync(file, "utf8").length / 4); } catch { return 0; }
}

function classify(root: string, file: string): Kind {
  const rel = relative(root, file);
  const name = basename(file);
  // The root index and every sub-index (context/<area>/index.md) are index files, not topics.
  if (name === "index.md" && (rel.startsWith("context/") || rel.startsWith("context\\"))) return "index";
  if (name === "CLAUDE.md") return dirname(rel) === "." ? "root" : "colocated";
  if (rel.startsWith("context/") || rel.startsWith("context\\")) return "topic";
  if (name === "CLAUDE.local.md") return "skip";
  return "other";
}

function walk(
  root: string,
  dir: string,
  acc: string[],
  isIgnored: (rel: string) => boolean,
  counts: { files: number; dirs: number },
): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".claude" && e.name !== ".github") continue;
    const full = join(dir, e.name);
    const rel = relative(root, full);
    if (isIgnored(rel)) {
      if (e.isDirectory()) counts.dirs++;
      else if (e.name.endsWith(".md")) counts.files++;
      continue;
    }
    if (e.isDirectory()) {
      if (!PRUNE.has(e.name)) walk(root, full, acc, isIgnored, counts);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}

function checkText(file: string, add: AddFn): void {
  const lines = readFileSync(file, "utf8").split("\n");
  let inFence = false;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const tok = line.trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") { inFence = !inFence; continue; }
    if (inFence) continue;
    const p = prose(line);
    for (const rule of DECORATIVE) {
      rule.re.lastIndex = 0;
      if (rule.re.test(p)) add(file, n + 1, "warn", `${rule.name} in prose -> costs tokens, no information gain`);
    }
    if (/\\[*_[\]]/.test(p)) {
      add(file, n + 1, "warn", "backslash-escaped markdown (\\* \\_ \\[) -> backtick the token instead");
    }
  }
}

function checkLength(file: string, kind: Kind, add: AddFn): void {
  const b = BUDGET[kind];
  if (!b) return;
  const n = readFileSync(file, "utf8").split("\n").length;
  if (n > b.err) add(file, n, "error", `${n} lines > ${b.err} budget for a ${kind} file -> extract content`);
  else if (n > b.warn) add(file, n, "warn", `${n} lines > ${b.warn} (ideal) for a ${kind} file`);
}

function checkRootImport(file: string, hasContextDir: boolean, add: AddFn): void {
  if (!hasContextDir) return;
  if (!/^@context\/index\.md\s*$/m.test(readFileSync(file, "utf8"))) {
    add(file, 0, "error", 'root CLAUDE.md must contain the line "@context/index.md"');
  }
}

// High-confidence root-ordering checks. With `fix`, relocate a misplaced `@context/index.md`
// import to the last line (purely positional, safe to automate); return 1 if it wrote.
function checkRootOrder(file: string, add: AddFn, fix: boolean): number {
  const lines = readFileSync(file, "utf8").split("\n");
  const headers: Array<{ title: string; line: number }> = [];
  let inFence = false;
  lines.forEach((line, i) => {
    const t = line.trimStart().slice(0, 3);
    if (t === "```" || t === "~~~") { inFence = !inFence; return; }
    if (inFence) return;
    const h = line.match(/^##\s+(.*)$/);
    if (h) headers.push({ title: h[1].toLowerCase(), line: i + 1 });
  });
  const idx = (kw: string) => headers.findIndex((h) => h.title.includes(kw));
  const cmd = idx("command"), arch = idx("architecture");
  if (cmd > -1 && arch > -1 && cmd > arch) {
    add(file, headers[cmd].line, "warn", '"## Commands" appears after "## Architecture" -> commands are highest-value; put them first');
  }
  const importLine = lines.findIndex((l) => /^@context\/index\.md\s*$/.test(l));
  if (importLine > -1) {
    const after = lines.slice(importLine + 1).filter((l) => l.trim() !== "");
    if (after.length) {
      if (fix) {
        const moved = lines.filter((_, i) => i !== importLine);
        while (moved.length && moved[moved.length - 1].trim() === "") moved.pop();
        moved.push(lines[importLine]);
        writeFileSync(file, moved.join("\n") + "\n");
        return 1;
      }
      add(file, importLine + 1, "warn", `@context/index.md should be the last line; ${after.length} non-empty line(s) follow it`);
    }
  }
  return 0;
}

// A fenced code block in an always-loaded file (root/colocated CLAUDE.md or the index) is the
// inlined-snippet smell; point at the source file instead. Topic docs are exempt.
function checkNoFencedCode(file: string, kind: Kind, add: AddFn): void {
  if (kind !== "root" && kind !== "colocated" && kind !== "index") return;
  const lines = readFileSync(file, "utf8").split("\n");
  for (let n = 0; n < lines.length; n++) {
    const tok = lines[n].trimStart().slice(0, 3);
    if (tok !== "```" && tok !== "~~~") continue;
    add(file, n + 1, "warn", `fenced code block in ${kind === "index" ? "the index" : "CLAUDE.md"} -> link to the source file instead of inlining a snippet`);
    for (n++; n < lines.length; n++) {
      const t = lines[n].trimStart().slice(0, 3);
      if (t === "```" || t === "~~~") break;
    }
  }
}

// A dated verification claim in prose with no nearby anchor rots silently.
function checkStaleProse(file: string, kind: Kind, add: AddFn): void {
  if (kind !== "topic" && kind !== "root" && kind !== "colocated") return;
  const lines = readFileSync(file, "utf8").split("\n");
  let inFence = false;
  for (let n = 0; n < lines.length; n++) {
    const tok = lines[n].trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") { inFence = !inFence; continue; }
    if (inFence) continue;
    const p = prose(lines[n]);
    const verb = p.match(STATE_VERB);
    const date = p.match(ISO_DATE);
    if (!verb || !date) continue;
    const lo = Math.max(0, n - ANCHOR_WINDOW);
    const hi = Math.min(lines.length - 1, n + ANCHOR_WINDOW);
    let anchored = false;
    for (let k = lo; k <= hi && !anchored; k++) {
      if (ANCHOR_LABEL_RE.test(prose(lines[k]))) anchored = true;
    }
    if (!anchored) {
      add(file, n + 1, "warn", `dated state claim ("${verb[0]} ... ${date[0]}") with no nearby anchor -> add verify:/source:/stale-by: or make it a check's output`);
    }
  }
}

const ROOT_INDEX = "context/index.md";

export interface TreeEntry extends IndexEntry {
  /** Repo-relative path of the index that lists this entry. */
  index: string;
  /** 0 for context/index.md, 1 for an area index it lists, and so on. */
  depth: number;
}

interface IndexTree {
  entries: TreeEntry[];
  /** Every index reached, root first, in walk order. */
  indexes: string[];
  /** Entries pointing at an index already reached - a cycle, or a second parent. */
  revisits: TreeEntry[];
}

// Walk the index tree from context/index.md. An entry pointing at another index under
// context/ (`context/<area>/index.md`) is a sub-index: its entries are read in turn,
// depth-first, each index once. A missing sub-index is left to the dangling-pointer check.
function walkIndexTree(root: string): IndexTree {
  const tree: IndexTree = { entries: [], indexes: [], revisits: [] };
  const seen = new Set<string>();
  const visit = (rel: string, depth: number): void => {
    seen.add(rel);
    tree.indexes.push(rel);
    for (const e of parseIndexEntries(readFileSync(join(root, rel), "utf8"))) {
      const te: TreeEntry = { ...e, index: rel, depth };
      tree.entries.push(te);
      if (!isIndexPath(e.path) || !existsSync(join(root, e.path))) continue;
      if (seen.has(e.path)) tree.revisits.push(te);
      else visit(e.path, depth + 1);
    }
  };
  if (existsSync(join(root, ROOT_INDEX))) visit(ROOT_INDEX, 0);
  return tree;
}

// Every markdown file under context/, at any depth, as repo-relative posix paths.
function listContextFiles(root: string, dir: string, acc: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!PRUNE.has(e.name)) listContextFiles(root, full, acc);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      acc.push(relative(root, full).split("\\").join("/"));
    }
  }
  return acc;
}

function checkIndexTree(root: string, contextDir: string, add: AddFn): IndexTree {
  const tree = walkIndexTree(root);
  const referenced = new Set<string>([ROOT_INDEX]);
  for (const e of tree.entries) {
    const indexFile = join(root, e.index);
    if (e.eager) add(indexFile, e.line, "error", 'index entry uses eager "@" prefix -> use a bare path');
    if (e.path.startsWith("context/")) referenced.add(e.path);
    if (!e.hasUseWhen) add(indexFile, e.line, "error", `index entry "${e.path}" has no "Use when:" trigger`);
    if (!existsSync(join(root, e.path))) {
      const external = !e.path.startsWith("context/");
      add(indexFile, e.line, external ? "warn" : "error", `index points to missing file: ${e.path}${external ? " (external/managed? verify it resolves)" : ""}`);
    }
    for (const g of e.globs) {
      const prefix = globStaticPrefix(g);
      if (prefix && !existsSync(join(root, prefix))) {
        add(indexFile, e.line, "warn", `paths: glob \`${g}\` -> directory "${prefix}" doesn't exist (stale glob? dir renamed/removed)`);
      }
    }
  }
  for (const r of tree.revisits) {
    add(join(root, r.index), r.line, "warn", `index entry "${r.path}" points at an index already reached -> list each index from exactly one parent (a cycle or a second parent)`);
  }
  for (const rel of tree.indexes) {
    const own = tree.entries.filter((e) => e.index === rel);
    const file = join(root, rel);
    if (own.length > INDEX_SOFT_MAX) {
      add(file, 0, "warn", rel === ROOT_INDEX
        ? `${own.length} index entries > ${INDEX_SOFT_MAX} soft cap -> the eager index is itself a context cost; split by area into context/<area>/index.md sub-indexes`
        : `${own.length} entries > ${INDEX_SOFT_MAX} soft cap for one index -> split this area further`);
    }
    checkTriggerOverlap(file, own, add);
  }
  // Orphans: every doc and sub-index under context/, at any depth, must be listed by an index
  // reachable from the root - matched by full path, so a same-named file elsewhere can't cover it.
  for (const rel of listContextFiles(root, contextDir)) {
    if (referenced.has(rel)) continue;
    add(join(root, rel), 0, "error", isIndexPath(rel)
      ? "sub-index not referenced by any index reachable from context/index.md -> list it in a parent index or delete it (its docs never lazy-load)"
      : "topic doc not referenced by any index reachable from context/index.md -> add an entry or delete the file (orphans never lazy-load)");
  }
  return tree;
}

// Two triggers sharing distinctive (rare) keywords may route ambiguously.
function checkTriggerOverlap(indexFile: string, entries: IndexEntry[], add: AddFn): void {
  const n = entries.length;
  if (n < 2) return;
  const kw = entries.map((e) => keywords(e.trigger));
  const df = new Map<string, number>();
  for (const set of kw) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const distinctiveMax = Math.max(2, Math.floor(n * 0.15));
  const pairs: Array<{ a: string; b: string; shared: string[]; line: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const shared = [...kw[i]].filter((w) => kw[j].has(w) && (df.get(w) ?? 0) <= distinctiveMax);
      if (shared.length >= 2) pairs.push({ a: entries[i].path, b: entries[j].path, shared, line: entries[i].line });
    }
  }
  pairs.sort((x, y) => y.shared.length - x.shared.length);
  for (const p of pairs.slice(0, 8)) {
    add(indexFile, p.line, "warn", `triggers overlap: ${p.a} & ${p.b} share [${p.shared.join(", ")}] -> may route ambiguously; sharpen one`);
  }
}

// Trigger keywords largely absent from the doc body => the trigger is stale or the doc drifted.
function checkTriggerDrift(root: string, entries: IndexEntry[], add: AddFn): void {
  for (const e of entries) {
    if (!e.path.startsWith("context/")) continue;
    const f = join(root, e.path);
    if (!existsSync(f)) continue; // dangling handled by checkIndex
    const kws = [...keywords(e.trigger)];
    if (kws.length < 3) continue;
    const body = readFileSync(f, "utf8").toLowerCase();
    const missing = kws.filter((w) => !body.includes(w));
    const coverage = (kws.length - missing.length) / kws.length;
    if (coverage < 0.4) {
      add(f, 0, "warn", `only ${Math.round(coverage * 100)}% of trigger keywords appear in the doc (missing [${missing.slice(0, 6).join(", ")}]) -> trigger may be stale or the doc drifted`);
    }
  }
}

function checkDuplicates(root: string, contextDir: string, add: AddFn): void {
  const bodies = new Map<string, string[]>();
  for (const rel of listContextFiles(root, contextDir)) {
    if (isIndexPath(rel)) continue;
    const norm = readFileSync(join(root, rel), "utf8").replace(/^#.*$/m, "").replace(/\s+/g, " ").trim();
    const list = bodies.get(norm) ?? [];
    list.push(rel);
    bodies.set(norm, list);
  }
  for (const [, list] of bodies) {
    if (list.length > 1) {
      add(join(root, list[0]), 0, "error", `identical body to ${list.slice(1).join(", ")} -> merge into one and delete the rest`);
    }
  }
}

// Validate the lazy-loaded CLAUDE.md + context/index.md corpus under `root`. Reads the whole
// tree (minus PRUNE + the ignore list); with `opts.fix` it rewrites the safe mechanical
// violations. Punctuation is never flagged or rewritten (em dashes are house style).
export function checkContext(root: string, opts: ContextOptions = {}): ContextResult {
  const findings: ContextFinding[] = [];
  const add: AddFn = (file, line, sev, msg) => {
    findings.push({ file: relative(root, file) || basename(file), line, sev, msg });
  };
  let fixed = 0;

  const isIgnored = makeIsIgnored(loadIgnore(root, opts.ignore));
  const ignored = { files: 0, dirs: 0 };

  const contextDir = join(root, "context");
  const hasContextDir = existsSync(contextDir) && statSync(contextDir).isDirectory();

  for (const file of walk(root, root, [], isIgnored, ignored)) {
    const kind = classify(root, file);
    if (kind === "skip" || kind === "other") continue;
    checkText(file, add);
    checkLength(file, kind, add);
    checkStaleProse(file, kind, add);
    checkNoFencedCode(file, kind, add);
    if (kind === "root") {
      checkRootImport(file, hasContextDir, add);
      fixed += checkRootOrder(file, add, opts.fix ?? false);
    }
  }

  let entryCount = 0;
  let indexCount = 0;
  if (hasContextDir) {
    const indexFile = join(contextDir, "index.md");
    if (existsSync(indexFile)) {
      const tree = checkIndexTree(root, contextDir, add);
      entryCount = tree.entries.length;
      indexCount = tree.indexes.length;
      checkTriggerDrift(root, tree.entries, add);
    }
    checkDuplicates(root, contextDir, add);
    const rootClaude = join(root, "CLAUDE.md");
    if (existsSync(rootClaude) && existsSync(indexFile)) {
      const t = approxTokens(rootClaude) + approxTokens(indexFile);
      if (t > ALWAYS_LOADED_TOKEN_WARN) {
        add(rootClaude, 0, "warn", `always-loaded layer (root CLAUDE.md + index) ~${t} tokens > ${ALWAYS_LOADED_TOKEN_WARN} -> trim; every always-loaded token competes with task instructions`);
      }
    }
  }

  return { findings, entries: entryCount, indexes: indexCount, fixed, ignored };
}

export function loadIndexEntries(root: string): IndexEntry[] {
  const f = join(root, "context", "index.md");
  return existsSync(f) ? parseIndexEntries(readFileSync(f, "utf8")) : [];
}

// Every entry across the index tree, depth-first, each tagged with the index that lists it.
export function loadIndexTree(root: string): TreeEntry[] {
  return walkIndexTree(root).entries;
}
