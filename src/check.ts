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

// Lines are a proxy for size, and a gameable one: 199 lines of 1,000-char prose pass a line
// budget at ten times its cost. Tokens are the cost that loads, so they get a budget too.
const TOKEN_BUDGET: Record<string, { warn: number; err: number }> = {
  colocated: { warn: 2500, err: 5000 },
  topic: { warn: 5000, err: 10000 },
};

// Dense instruction markdown (paths, backticks, flags) tokenizes nearer 2.5 chars/token than
// the 4 usually quoted. Erring low is what lets an over-budget file pass, so estimate at 3.
const CHARS_PER_TOKEN = 3;

const INDEX_SOFT_MAX = 20;

const ALWAYS_LOADED_TOKEN_WARN = 2500;

// A prose line this long is a paragraph packed onto one line, usually to stay under a line
// budget. Checked only in files that load without being asked for; a topic doc's token budget
// already covers it.
const LONG_LINE = 400;

// A colocated CLAUDE.md loads together with every colocated CLAUDE.md above it, so the cost of
// touching a file is the whole ancestor stack, not the nearest file.
const STACK_TOKEN_WARN = 6000;

// Index prose telling the agent to read docs before a trigger matches. It turns every lazy doc
// whose trigger is arguable into an eager one.
const READ_AHEAD = /\bwhen in doubt\b|\bif (?:in doubt|unsure)\b|\balways read\b|\bread (?:all|every|each) (?:of )?(?:the )?(?:entr|doc|file)/i;

// Trigger wording that matches nearly any task. Harmless on a short doc, costly on a long one.
const BROAD_TRIGGER = /\b(?:navigat\w*|overview|orientation|getting started|any (?:task|change|work)|every (?:task|change)|locating (?:which|where|an?|the) (?:app|service|package|module|code)\w*)\b/i;
const BROAD_DOC_TOKENS = 1500;

// Skill descriptions are listed in every session; bodies load whole on invocation, and only
// their first ~5k tokens survive a compaction.
const SKILL_DIRS = [".claude/skills", ".agents/skills"];
const SKILL_DESCRIPTION_MAX = 500;
const SKILL_BODY_TOKEN_WARN = 5000;
const SKILL_LISTING_TOKEN_WARN = 3000;

// Claude Code workflows (`.claude/workflows/*.js`) are listed every session too: their
// `meta.name`, `meta.description` and `meta.whenToUse`.
const WORKFLOW_DIR = ".claude/workflows";

// Each listed entry costs more than its text. Measured in Claude Code: hiding six skills
// whose name + description came to 2,810 chars cut the first request by 1,387 tokens, where
// chars/3 alone predicts ~940 - about 75 tokens per entry on top.
const LISTING_ENTRY_TOKENS = 75;

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

const tokensOf = (text: string): number => Math.round(text.length / CHARS_PER_TOKEN);

function approxTokens(file: string): number {
  try { return tokensOf(readFileSync(file, "utf8")); } catch { return 0; }
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

function checkTokens(file: string, kind: Kind, add: AddFn): void {
  const b = TOKEN_BUDGET[kind];
  if (!b) return;
  const t = approxTokens(file);
  const where = kind === "colocated"
    ? "move runbook and reference detail into context/ docs, keeping the rules here"
    : "split it by situation so each trigger loads only what it needs";
  if (t > b.err) add(file, 0, "error", `~${t} tokens > ${b.err} budget for a ${kind} file -> ${where}`);
  else if (t > b.warn) add(file, 0, "warn", `~${t} tokens > ${b.warn} (ideal) for a ${kind} file -> ${where}`);
}

function checkLongLines(file: string, add: AddFn): void {
  const lines = readFileSync(file, "utf8").split("\n");
  let inFence = false;
  let count = 0, longest = 0, first = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const tok = line.trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") { inFence = !inFence; continue; }
    if (inFence || line.trimStart().startsWith("|")) continue;
    if (line.length <= LONG_LINE) continue;
    count++;
    if (!first) first = n + 1;
    longest = Math.max(longest, line.length);
  }
  if (count) {
    add(file, first, "warn", `${count} line(s) over ${LONG_LINE} chars (longest ${longest}) -> the line count understates this file's size; break up the paragraphs or move the detail out`);
  }
}

// Each colocated CLAUDE.md plus every colocated CLAUDE.md above it: what loads together when a
// file in that directory is touched. Root CLAUDE.md is excluded - it is already always loaded.
function checkStacks(root: string, colocated: string[], add: AddFn): void {
  const tokens = new Map(colocated.map((f) => [dirname(relative(root, f)), approxTokens(f)]));
  for (const file of colocated) {
    let dir = dirname(relative(root, file));
    const stack: string[] = [];
    let total = 0;
    while (dir !== "." && dir !== "") {
      const t = tokens.get(dir);
      if (t !== undefined) { stack.push(dir); total += t; }
      dir = dirname(dir);
    }
    if (stack.length > 1 && total > STACK_TOKEN_WARN) {
      add(file, 0, "warn", `loads with ${plural(stack.length - 1, "ancestor CLAUDE.md", "ancestor CLAUDE.md files")} (${stack.slice(1).join(", ")}) for ~${total} tokens > ${STACK_TOKEN_WARN} -> slim the stack; move detail into context/ docs rather than another nested CLAUDE.md`);
    }
  }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// Directive lines in an index (not its entries) that tell the agent to read ahead.
function checkReadAhead(file: string, add: AddFn): void {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*-\s+/.test(line)) return;
    const m = prose(line).match(READ_AHEAD);
    if (m) {
      add(file, i + 1, "warn", `directive tells the agent to read ahead ("${m[0]}") -> route only on a matching "Use when"; a doc read ahead loads on tasks that never needed it`);
    }
  });
}

function checkBroadTriggers(root: string, entries: TreeEntry[], add: AddFn): void {
  for (const e of entries) {
    if (!e.path.startsWith("context/") || isIndexPath(e.path)) continue;
    const m = e.trigger.match(BROAD_TRIGGER);
    if (!m) continue;
    const t = approxTokens(join(root, e.path));
    if (t > BROAD_DOC_TOKENS) {
      add(join(root, e.index), e.line, "warn", `broad trigger ("${m[0]}") routes a ~${t}-token doc onto nearly every task -> name the specific situations it serves, or move the always-needed lines into CLAUDE.md`);
    }
  }
}

// The `description:` value from SKILL.md frontmatter: inline (quoted or not), or a `>`/`|` block.
function skillDescription(text: string): string {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return "";
  const lines = fm[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i === -1) return "";
  const inline = lines[i].replace(/^description:\s*/, "");
  if (inline && !/^[>|][-+]?$/.test(inline)) return inline.replace(/^(["'])([\s\S]*)\1$/, "$2");
  const block: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (!/^\s/.test(l)) break;
    block.push(l.trim());
  }
  return block.join(" ");
}

// A skill hidden from the model (Claude Code's `disable-model-invocation: true`) is not in the
// listing; a person still starts it with /<name>.
const isHiddenSkill = (text: string): boolean =>
  /^disable-model-invocation:\s*true\s*$/m.test(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "");

// The string literal starting at `i` (quote char at s[i]), unescaped; "" if there is none.
function readStringLiteral(s: string, i: number): string {
  const q = s[i];
  if (q !== '"' && q !== "'" && q !== "`") return "";
  let out = "";
  for (let k = i + 1; k < s.length; k++) {
    const c = s[k];
    if (c === "\\") { out += s[++k] ?? ""; continue; }
    if (c === q) return out;
    out += c;
  }
  return "";
}

// `meta.<key>` from a workflow script's `export const meta = { ... }` literal.
function workflowMetaField(src: string, key: string): string {
  const start = src.indexOf("export const meta");
  if (start === -1) return "";
  // The literal ends at the first line that closes it at column 0.
  const end = src.slice(start).search(/\n\}/);
  const meta = end === -1 ? src.slice(start) : src.slice(start, start + end);
  const hit = new RegExp(`\\b${key}\\s*:\\s*`).exec(meta);
  return hit ? readStringLiteral(meta, hit.index + hit[0].length) : "";
}

// Project plugins switched on in `.claude/settings.json`: their skills are listed too, but
// their files live outside the repo.
function enabledPlugins(root: string): string[] {
  try {
    const s = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
    return Object.entries(s.enabledPlugins ?? {}).filter(([, on]) => on === true).map(([name]) => name);
  } catch {
    return [];
  }
}

function checkSkills(root: string, isIgnored: (rel: string) => boolean, add: AddFn): void {
  let listing = 0, count = 0, hidden = 0;
  let firstDir = "";
  for (const base of SKILL_DIRS) {
    let dirs;
    try {
      dirs = readdirSync(join(root, base), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirs) {
      const rel = join(base, d.name);
      if (!d.isDirectory() || isIgnored(rel)) continue;
      const file = join(root, rel, "SKILL.md");
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      const desc = skillDescription(text);
      if (!firstDir) firstDir = file;
      if (isHiddenSkill(text)) {
        hidden++;
      } else {
        count++;
        listing += tokensOf(d.name + desc) + LISTING_ENTRY_TOKENS;
      }
      if (desc.length > SKILL_DESCRIPTION_MAX) {
        add(file, 0, "warn", `skill description is ${desc.length} chars > ${SKILL_DESCRIPTION_MAX} -> it is listed in every session; say what the skill does and when in a sentence or two, and move trigger catalogues into the body`);
      }
      const t = tokensOf(text);
      if (t > SKILL_BODY_TOKEN_WARN) {
        add(file, 0, "warn", `SKILL.md ~${t} tokens > ${SKILL_BODY_TOKEN_WARN} -> it loads whole when invoked and only its first ~${SKILL_BODY_TOKEN_WARN} tokens survive a compaction; put the rules first and move reference detail into references/ files`);
      }
    }
  }
  let workflows = 0;
  let files: string[] = [];
  try {
    files = readdirSync(join(root, WORKFLOW_DIR)).filter((f) => /\.m?js$/.test(f)).sort();
  } catch {
    // no workflows
  }
  for (const f of files) {
    const rel = join(WORKFLOW_DIR, f);
    if (isIgnored(rel)) continue;
    const file = join(root, rel);
    const src = readFileSync(file, "utf8");
    const desc = workflowMetaField(src, "description");
    if (!desc) continue;
    const when = workflowMetaField(src, "whenToUse");
    workflows++;
    listing += tokensOf(workflowMetaField(src, "name") + desc + when) + LISTING_ENTRY_TOKENS;
    if (!firstDir) firstDir = file;
    if (desc.length + when.length > SKILL_DESCRIPTION_MAX) {
      add(file, 0, "warn", `workflow listing text (meta.description + meta.whenToUse) is ${desc.length + when.length} chars > ${SKILL_DESCRIPTION_MAX} -> it is listed in every session; say what it does and when in a sentence or two, and move argument detail into a comment or doc the workflow points at`);
    }
  }
  if (listing > SKILL_LISTING_TOKEN_WARN) {
    const plugins = enabledPlugins(root);
    const what = [plural(count, "skill", "skills"), ...(workflows ? [plural(workflows, "workflow", "workflows")] : [])].join(" + ");
    const notCounted = [
      ...(hidden ? [`${plural(hidden, "hidden skill", "hidden skills")}, which are not listed`] : []),
      ...(plugins.length ? [`skills of enabled plugin(s) ${plugins.join(", ")}`] : []),
    ];
    add(firstDir, 0, "warn", `project skill/workflow listing ~${listing} tokens across ${what} > ${SKILL_LISTING_TOKEN_WARN}${notCounted.length ? ` (not counted: ${notCounted.join("; ")})` : ""} -> it loads every session; trim descriptions, merge overlapping skills, and hide skills people start by hand from the model where the agent supports it (e.g. Claude Code's disable-model-invocation)`);
  }
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

  const colocated: string[] = [];
  for (const file of walk(root, root, [], isIgnored, ignored)) {
    const kind = classify(root, file);
    if (kind === "skip" || kind === "other") continue;
    if (kind === "colocated") colocated.push(file);
    if (kind === "index") checkReadAhead(file, add);
    checkText(file, add);
    checkLength(file, kind, add);
    checkTokens(file, kind, add);
    if (kind !== "topic") checkLongLines(file, add);
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
      checkBroadTriggers(root, tree.entries, add);
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

  checkStacks(root, colocated, add);
  checkSkills(root, isIgnored, add);

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
