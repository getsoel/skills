#!/usr/bin/env node

// src/cli.ts
import { execFileSync } from "node:child_process";
import { existsSync as existsSync6, realpathSync } from "node:fs";
import { resolve } from "node:path";

// src/check.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join as join2, relative } from "node:path";

// src/glob.ts
function globStaticPrefix(glob) {
  const cut = glob.search(/[*?]/);
  const head = cut === -1 ? glob : glob.slice(0, cut);
  const slash = head.lastIndexOf("/");
  return slash === -1 ? "" : head.slice(0, slash);
}

// src/index-entry.ts
function parseIndexEntries(text) {
  const out = [];
  text.split(`
`).forEach((line, i) => {
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (!bullet)
      return;
    const body = bullet[1];
    const pathMatch = body.match(/`?([\w./-]+\.md)`?/);
    if (!pathMatch)
      return;
    const tw = body.match(/use when:\s*(.*?)\s*(?:;\s*paths:.*)?$/i);
    const pm = body.match(/;\s*paths:\s*(.+)$/i);
    out.push({
      path: pathMatch[1],
      trigger: tw ? tw[1].trim() : "",
      hasUseWhen: /use when:/i.test(body),
      globs: pm ? [...pm[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [],
      eager: /`?@[\w./-]+\.md`?/.test(body),
      line: i + 1
    });
  });
  return out;
}
function isIndexPath(path) {
  return /^context\/(?:[^/]+\/)*index\.md$/.test(path);
}

// src/vocabulary.ts
var ANCHORS = [
  "source",
  "invariant",
  "enforce",
  "verify",
  "stale-by"
];
var GUARDS = ["enforce", "verify"];
var EXTERNAL_LABEL_RE = /\bexternal:/i;
var FOOTGUN_SIGNALS = [
  "gotcha",
  "footgun",
  "foot-gun",
  "silently",
  "caveat",
  "pitfall"
];
var FOOTGUN_SECTIONS = [
  "gotcha",
  "pitfall",
  "footgun",
  "foot-gun",
  "caveat",
  "sharp edge",
  "watch out"
];
var esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var flex = (t) => esc(t).split(" ").join("\\s*");
var ANCHOR_LABEL_RE = new RegExp(`\\b(?:${ANCHORS.map(esc).join("|")}):`, "i");
var GUARD_LABEL_RE = new RegExp(`\\b(?:${GUARDS.map(esc).join("|")}):`, "i");
var INVARIANT_LABEL_RE = /\binvariant:/i;
var FOOTGUN_WORD_RE = new RegExp(`\\b(?:${FOOTGUN_SIGNALS.map(esc).join("|")})\\b`, "i");
var FOOTGUN_SECTION_RE = new RegExp(`^#{1,6}\\s+.*(?:${FOOTGUN_SECTIONS.map(flex).join("|")})`, "i");

// src/ignore.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var IGNORE_FILE = ".contextignore";
function loadIgnore(root, extra) {
  const raw = [];
  const file = join(root, IGNORE_FILE);
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(`
`)) {
      const t = line.trim();
      if (t && !t.startsWith("#"))
        raw.push(t);
    }
  }
  for (const p of extra ?? []) {
    const t = p.trim();
    if (t)
      raw.push(t);
  }
  return raw.map((r) => {
    const p = r.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/, "");
    return { p, anchored: p.includes("/") };
  }).filter((x) => x.p);
}
function makeIsIgnored(ignore) {
  return (rel) => {
    const path = rel.split("\\").join("/");
    return ignore.some(({ p, anchored }) => anchored ? path === p || path.startsWith(p + "/") : path.split("/").includes(p));
  };
}

// src/check.ts
var PRUNE = new Set([
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
  "worktrees"
]);
var BUDGET = {
  root: { warn: 100, err: 150 },
  colocated: { warn: 150, err: 200 },
  topic: { warn: 150, err: 200 }
};
var INDEX_SOFT_MAX = 20;
var ALWAYS_LOADED_TOKEN_WARN = 2500;
var DECORATIVE = [
  { re: /[✓✗✅❌]/g, name: "decorative check/cross glyph" }
];
var STOP = new Set([
  "use",
  "when",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "from",
  "by",
  "its",
  "it",
  "this",
  "that",
  "into",
  "out",
  "at",
  "any",
  "new",
  "via",
  "per",
  "adding",
  "editing",
  "working",
  "writing",
  "using",
  "creating",
  "modifying",
  "touching",
  "changing",
  "running",
  "seeing",
  "making",
  "setting",
  "checking",
  "updating",
  "handling",
  "calling",
  "add",
  "edit",
  "run",
  "file",
  "files",
  "page",
  "pages",
  "code",
  "data"
]);
var STATE_VERB = /\b(verified|re-verified|confirmed|last (?:verified|checked)|as of)\b/i;
var ISO_DATE = /\b\d{4}-\d{2}(?:-\d{2})?\b/;
var ANCHOR_WINDOW = 6;
function segments(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf("`", i);
    if (tick === -1) {
      out.push({ code: false, text: line.slice(i) });
      break;
    }
    if (tick > i)
      out.push({ code: false, text: line.slice(i, tick) });
    const end = line.indexOf("`", tick + 1);
    if (end === -1) {
      out.push({ code: false, text: line.slice(tick) });
      break;
    }
    out.push({ code: true, text: line.slice(tick, end + 1) });
    i = end + 1;
  }
  return out;
}
var prose = (line) => segments(line).filter((s) => !s.code).map((s) => s.text).join("");
function keywords(text) {
  const out = new Set;
  for (const w of text.toLowerCase().match(/[a-z0-9][a-z0-9_./+-]{2,}/g) ?? []) {
    if (!STOP.has(w))
      out.add(w);
  }
  return out;
}
function approxTokens(file) {
  try {
    return Math.round(readFileSync2(file, "utf8").length / 4);
  } catch {
    return 0;
  }
}
function classify(root, file) {
  const rel = relative(root, file);
  const name = basename(file);
  if (name === "index.md" && (rel.startsWith("context/") || rel.startsWith("context\\")))
    return "index";
  if (name === "CLAUDE.md")
    return dirname(rel) === "." ? "root" : "colocated";
  if (rel.startsWith("context/") || rel.startsWith("context\\"))
    return "topic";
  if (name === "CLAUDE.local.md")
    return "skip";
  return "other";
}
function walk(root, dir, acc, isIgnored, counts) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".claude" && e.name !== ".github")
      continue;
    const full = join2(dir, e.name);
    const rel = relative(root, full);
    if (isIgnored(rel)) {
      if (e.isDirectory())
        counts.dirs++;
      else if (e.name.endsWith(".md"))
        counts.files++;
      continue;
    }
    if (e.isDirectory()) {
      if (!PRUNE.has(e.name))
        walk(root, full, acc, isIgnored, counts);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      acc.push(full);
    }
  }
  return acc;
}
function checkText(file, add) {
  const lines = readFileSync2(file, "utf8").split(`
`);
  let inFence = false;
  for (let n = 0;n < lines.length; n++) {
    const line = lines[n];
    const tok = line.trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") {
      inFence = !inFence;
      continue;
    }
    if (inFence)
      continue;
    const p = prose(line);
    for (const rule of DECORATIVE) {
      rule.re.lastIndex = 0;
      if (rule.re.test(p))
        add(file, n + 1, "warn", `${rule.name} in prose -> costs tokens, no information gain`);
    }
    if (/\\[*_[\]]/.test(p)) {
      add(file, n + 1, "warn", "backslash-escaped markdown (\\* \\_ \\[) -> backtick the token instead");
    }
  }
}
function checkLength(file, kind, add) {
  const b = BUDGET[kind];
  if (!b)
    return;
  const n = readFileSync2(file, "utf8").split(`
`).length;
  if (n > b.err)
    add(file, n, "error", `${n} lines > ${b.err} budget for a ${kind} file -> extract content`);
  else if (n > b.warn)
    add(file, n, "warn", `${n} lines > ${b.warn} (ideal) for a ${kind} file`);
}
function checkRootImport(file, hasContextDir, add) {
  if (!hasContextDir)
    return;
  if (!/^@context\/index\.md\s*$/m.test(readFileSync2(file, "utf8"))) {
    add(file, 0, "error", 'root CLAUDE.md must contain the line "@context/index.md"');
  }
}
function checkRootOrder(file, add, fix) {
  const lines = readFileSync2(file, "utf8").split(`
`);
  const headers = [];
  let inFence = false;
  lines.forEach((line, i) => {
    const t = line.trimStart().slice(0, 3);
    if (t === "```" || t === "~~~") {
      inFence = !inFence;
      return;
    }
    if (inFence)
      return;
    const h = line.match(/^##\s+(.*)$/);
    if (h)
      headers.push({ title: h[1].toLowerCase(), line: i + 1 });
  });
  const idx = (kw) => headers.findIndex((h) => h.title.includes(kw));
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
        while (moved.length && moved[moved.length - 1].trim() === "")
          moved.pop();
        moved.push(lines[importLine]);
        writeFileSync(file, moved.join(`
`) + `
`);
        return 1;
      }
      add(file, importLine + 1, "warn", `@context/index.md should be the last line; ${after.length} non-empty line(s) follow it`);
    }
  }
  return 0;
}
function checkNoFencedCode(file, kind, add) {
  if (kind !== "root" && kind !== "colocated" && kind !== "index")
    return;
  const lines = readFileSync2(file, "utf8").split(`
`);
  for (let n = 0;n < lines.length; n++) {
    const tok = lines[n].trimStart().slice(0, 3);
    if (tok !== "```" && tok !== "~~~")
      continue;
    add(file, n + 1, "warn", `fenced code block in ${kind === "index" ? "the index" : "CLAUDE.md"} -> link to the source file instead of inlining a snippet`);
    for (n++;n < lines.length; n++) {
      const t = lines[n].trimStart().slice(0, 3);
      if (t === "```" || t === "~~~")
        break;
    }
  }
}
function checkStaleProse(file, kind, add) {
  if (kind !== "topic" && kind !== "root" && kind !== "colocated")
    return;
  const lines = readFileSync2(file, "utf8").split(`
`);
  let inFence = false;
  for (let n = 0;n < lines.length; n++) {
    const tok = lines[n].trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") {
      inFence = !inFence;
      continue;
    }
    if (inFence)
      continue;
    const p = prose(lines[n]);
    const verb = p.match(STATE_VERB);
    const date = p.match(ISO_DATE);
    if (!verb || !date)
      continue;
    const lo = Math.max(0, n - ANCHOR_WINDOW);
    const hi = Math.min(lines.length - 1, n + ANCHOR_WINDOW);
    let anchored = false;
    for (let k = lo;k <= hi && !anchored; k++) {
      if (ANCHOR_LABEL_RE.test(prose(lines[k])))
        anchored = true;
    }
    if (!anchored) {
      add(file, n + 1, "warn", `dated state claim ("${verb[0]} ... ${date[0]}") with no nearby anchor -> add verify:/source:/stale-by: or make it a check's output`);
    }
  }
}
var ROOT_INDEX = "context/index.md";
function walkIndexTree(root) {
  const tree = { entries: [], indexes: [], revisits: [] };
  const seen = new Set;
  const visit = (rel, depth) => {
    seen.add(rel);
    tree.indexes.push(rel);
    for (const e of parseIndexEntries(readFileSync2(join2(root, rel), "utf8"))) {
      const te = { ...e, index: rel, depth };
      tree.entries.push(te);
      if (!isIndexPath(e.path) || !existsSync2(join2(root, e.path)))
        continue;
      if (seen.has(e.path))
        tree.revisits.push(te);
      else
        visit(e.path, depth + 1);
    }
  };
  if (existsSync2(join2(root, ROOT_INDEX)))
    visit(ROOT_INDEX, 0);
  return tree;
}
function listContextFiles(root, dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith("."))
      continue;
    const full = join2(dir, e.name);
    if (e.isDirectory()) {
      if (!PRUNE.has(e.name))
        listContextFiles(root, full, acc);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      acc.push(relative(root, full).split("\\").join("/"));
    }
  }
  return acc;
}
function checkIndexTree(root, contextDir, add) {
  const tree = walkIndexTree(root);
  const referenced = new Set([ROOT_INDEX]);
  for (const e of tree.entries) {
    const indexFile = join2(root, e.index);
    if (e.eager)
      add(indexFile, e.line, "error", 'index entry uses eager "@" prefix -> use a bare path');
    if (e.path.startsWith("context/"))
      referenced.add(e.path);
    if (!e.hasUseWhen)
      add(indexFile, e.line, "error", `index entry "${e.path}" has no "Use when:" trigger`);
    if (!existsSync2(join2(root, e.path))) {
      const external = !e.path.startsWith("context/");
      add(indexFile, e.line, external ? "warn" : "error", `index points to missing file: ${e.path}${external ? " (external/managed? verify it resolves)" : ""}`);
    }
    for (const g of e.globs) {
      const prefix = globStaticPrefix(g);
      if (prefix && !existsSync2(join2(root, prefix))) {
        add(indexFile, e.line, "warn", `paths: glob \`${g}\` -> directory "${prefix}" doesn't exist (stale glob? dir renamed/removed)`);
      }
    }
  }
  for (const r of tree.revisits) {
    add(join2(root, r.index), r.line, "warn", `index entry "${r.path}" points at an index already reached -> list each index from exactly one parent (a cycle or a second parent)`);
  }
  for (const rel of tree.indexes) {
    const own = tree.entries.filter((e) => e.index === rel);
    const file = join2(root, rel);
    if (own.length > INDEX_SOFT_MAX) {
      add(file, 0, "warn", rel === ROOT_INDEX ? `${own.length} index entries > ${INDEX_SOFT_MAX} soft cap -> the eager index is itself a context cost; split by area into context/<area>/index.md sub-indexes` : `${own.length} entries > ${INDEX_SOFT_MAX} soft cap for one index -> split this area further`);
    }
    checkTriggerOverlap(file, own, add);
  }
  for (const rel of listContextFiles(root, contextDir)) {
    if (referenced.has(rel))
      continue;
    add(join2(root, rel), 0, "error", isIndexPath(rel) ? "sub-index not referenced by any index reachable from context/index.md -> list it in a parent index or delete it (its docs never lazy-load)" : "topic doc not referenced by any index reachable from context/index.md -> add an entry or delete the file (orphans never lazy-load)");
  }
  return tree;
}
function checkTriggerOverlap(indexFile, entries, add) {
  const n = entries.length;
  if (n < 2)
    return;
  const kw = entries.map((e) => keywords(e.trigger));
  const df = new Map;
  for (const set of kw)
    for (const w of set)
      df.set(w, (df.get(w) ?? 0) + 1);
  const distinctiveMax = Math.max(2, Math.floor(n * 0.15));
  const pairs = [];
  for (let i = 0;i < n; i++) {
    for (let j = i + 1;j < n; j++) {
      const shared = [...kw[i]].filter((w) => kw[j].has(w) && (df.get(w) ?? 0) <= distinctiveMax);
      if (shared.length >= 2)
        pairs.push({ a: entries[i].path, b: entries[j].path, shared, line: entries[i].line });
    }
  }
  pairs.sort((x, y) => y.shared.length - x.shared.length);
  for (const p of pairs.slice(0, 8)) {
    add(indexFile, p.line, "warn", `triggers overlap: ${p.a} & ${p.b} share [${p.shared.join(", ")}] -> may route ambiguously; sharpen one`);
  }
}
function checkTriggerDrift(root, entries, add) {
  for (const e of entries) {
    if (!e.path.startsWith("context/"))
      continue;
    const f = join2(root, e.path);
    if (!existsSync2(f))
      continue;
    const kws = [...keywords(e.trigger)];
    if (kws.length < 3)
      continue;
    const body = readFileSync2(f, "utf8").toLowerCase();
    const missing = kws.filter((w) => !body.includes(w));
    const coverage = (kws.length - missing.length) / kws.length;
    if (coverage < 0.4) {
      add(f, 0, "warn", `only ${Math.round(coverage * 100)}% of trigger keywords appear in the doc (missing [${missing.slice(0, 6).join(", ")}]) -> trigger may be stale or the doc drifted`);
    }
  }
}
function checkDuplicates(root, contextDir, add) {
  const bodies = new Map;
  for (const rel of listContextFiles(root, contextDir)) {
    if (isIndexPath(rel))
      continue;
    const norm = readFileSync2(join2(root, rel), "utf8").replace(/^#.*$/m, "").replace(/\s+/g, " ").trim();
    const list = bodies.get(norm) ?? [];
    list.push(rel);
    bodies.set(norm, list);
  }
  for (const [, list] of bodies) {
    if (list.length > 1) {
      add(join2(root, list[0]), 0, "error", `identical body to ${list.slice(1).join(", ")} -> merge into one and delete the rest`);
    }
  }
}
function checkContext(root, opts = {}) {
  const findings = [];
  const add = (file, line, sev, msg) => {
    findings.push({ file: relative(root, file) || basename(file), line, sev, msg });
  };
  let fixed = 0;
  const isIgnored = makeIsIgnored(loadIgnore(root, opts.ignore));
  const ignored = { files: 0, dirs: 0 };
  const contextDir = join2(root, "context");
  const hasContextDir = existsSync2(contextDir) && statSync(contextDir).isDirectory();
  for (const file of walk(root, root, [], isIgnored, ignored)) {
    const kind = classify(root, file);
    if (kind === "skip" || kind === "other")
      continue;
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
    const indexFile = join2(contextDir, "index.md");
    if (existsSync2(indexFile)) {
      const tree = checkIndexTree(root, contextDir, add);
      entryCount = tree.entries.length;
      indexCount = tree.indexes.length;
      checkTriggerDrift(root, tree.entries, add);
    }
    checkDuplicates(root, contextDir, add);
    const rootClaude = join2(root, "CLAUDE.md");
    if (existsSync2(rootClaude) && existsSync2(indexFile)) {
      const t = approxTokens(rootClaude) + approxTokens(indexFile);
      if (t > ALWAYS_LOADED_TOKEN_WARN) {
        add(rootClaude, 0, "warn", `always-loaded layer (root CLAUDE.md + index) ~${t} tokens > ${ALWAYS_LOADED_TOKEN_WARN} -> trim; every always-loaded token competes with task instructions`);
      }
    }
  }
  return { findings, entries: entryCount, indexes: indexCount, fixed, ignored };
}
function loadIndexTree(root) {
  return walkIndexTree(root).entries;
}

// src/footguns.ts
import { existsSync as existsSync3, readdirSync as readdirSync2, readFileSync as readFileSync3, statSync as statSync2 } from "node:fs";
import { join as join3, relative as relative2 } from "node:path";
var PRUNE2 = new Set([
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
  "worktrees"
]);
var CAT = {
  A: "invariant-without-guard",
  D: "scriptable-procedure",
  B: "gotcha-section",
  C: "hazard-phrase"
};
var RANK = { A: 0, D: 1, B: 2, C: 3 };
var GUARD_WINDOW = 6;
var HAZARD_RE = new RegExp(FOOTGUN_WORD_RE.source + `|passes?\\b[^.!?]*\\bbut\\b|breaks?\\b\\s+(if|when|on)\\b|fails?\\b\\s+(silently|only|on|if|to)\\b` + `|\\b401s?\\b\\s+on\\b|don'?t\\s+forget|easy\\s+to\\s+(forget|miss|break)|watch\\s+out|bites?\\s+you\\b`, "i");
var excerpt = (s) => {
  const t = s.replace(/^[\s>*-]+/, "").replace(/\s+/g, " ").trim();
  return t.length > 140 ? t.slice(0, 137) + "..." : t;
};
var bare = (l) => l.replace(/`[^`]*`/g, " ");
var COMMAND_SPAN_RE = /^(git|pnpm|npm|npx|yarn|bun|node|deno|make|cargo|go|docker|kubectl|helm|gh|terraform|bash|sh|cp|mv|rm|mkdir|curl|ssh|scp|rsync|psql|mysql|redis-cli|aws|gcloud|az|vault)\b/;
var ORDERING_RE = /\b(then|first|before|after|next|finally)\b/i;
var commandSpans = (l) => {
  let n = 0;
  for (const m of l.matchAll(/`([^`]+)`/g)) {
    if (COMMAND_SPAN_RE.test(m[1].trim()))
      n++;
  }
  return n;
};
var isScriptableProcedure = (line, bareLine) => commandSpans(line) >= 2 && ORDERING_RE.test(bareLine);
function walk2(root, dir, acc, isIgnored) {
  let entries;
  try {
    entries = readdirSync2(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".claude" && e.name !== ".github")
      continue;
    const full = join3(dir, e.name);
    const rel = relative2(root, full).split("\\").join("/");
    if (isIgnored(rel))
      continue;
    if (e.isDirectory()) {
      if (!PRUNE2.has(e.name))
        walk2(root, full, acc, isIgnored);
    } else if (e.isFile()) {
      if (e.name === "CLAUDE.md")
        acc.push(full);
      else if (/(^|\/)context\/(?:[^/]+\/)*[^/]+\.md$/.test(rel) && e.name !== "index.md")
        acc.push(full);
    }
  }
  return acc;
}
function scan(root, file) {
  const lines = readFileSync3(file, "utf8").split(`
`);
  const guardLines = [];
  lines.forEach((l, i) => {
    const tok = l.trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~")
      return;
    const b = bare(l);
    if (GUARD_LABEL_RE.test(b) || EXTERNAL_LABEL_RE.test(b))
      guardLines.push(i);
  });
  const hasGuardNear = (i) => guardLines.some((e) => Math.abs(e - i) <= GUARD_WINDOW);
  const perLine = new Map;
  let section = "";
  let isFootgunSection = false;
  let inFence = false;
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const tok = line.trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") {
      inFence = !inFence;
      continue;
    }
    if (inFence)
      continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      isFootgunSection = FOOTGUN_SECTION_RE.test(line);
      continue;
    }
    if (!line.trim())
      continue;
    const bareLine = bare(line);
    let cat = null;
    if (INVARIANT_LABEL_RE.test(bareLine) && !GUARD_LABEL_RE.test(bareLine) && !EXTERNAL_LABEL_RE.test(bareLine) && !hasGuardNear(i))
      cat = "A";
    else if (isScriptableProcedure(line, bareLine))
      cat = "D";
    else if (isFootgunSection && /^\s*[-*]\s+/.test(line))
      cat = "B";
    else if (HAZARD_RE.test(bareLine))
      cat = "C";
    if (!cat)
      continue;
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
    file: relative2(root, file).split("\\").join("/"),
    line: line + 1
  }));
}
function findFootguns(root, opts = {}) {
  if (!existsSync3(root) || !statSync2(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  const isIgnored = makeIsIgnored(loadIgnore(root, opts.ignore));
  const files = walk2(root, root, [], isIgnored);
  const findings = [];
  for (const f of files) {
    try {
      findings.push(...scan(root, f));
    } catch {}
  }
  findings.sort((a, b) => RANK[a.cat] - RANK[b.cat] || a.file.localeCompare(b.file) || a.line - b.line);
  const byCategory = { A: 0, B: 0, C: 0, D: 0 };
  for (const f of findings)
    byCategory[f.cat]++;
  return {
    scanned: files.length,
    total: findings.length,
    byCategory,
    findings
  };
}

// src/gather.ts
import { existsSync as existsSync4, readdirSync as readdirSync3, readFileSync as readFileSync4, statSync as statSync3 } from "node:fs";
import { homedir } from "node:os";
import { join as join4 } from "node:path";
function encodeProjectPath(absPath) {
  return absPath.replace(/[^a-zA-Z0-9]/g, "-");
}
function claudeProjectsRoot() {
  return join4(homedir(), ".claude", "projects");
}
function claudeProjectDir(absPath) {
  return join4(claudeProjectsRoot(), encodeProjectPath(absPath));
}
function newestSession(cwd) {
  const dir = claudeProjectDir(cwd);
  let entries;
  try {
    entries = readdirSync3(dir);
  } catch {
    return null;
  }
  let best = null;
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl"))
      continue;
    const full = join4(dir, entry);
    let mtime;
    try {
      mtime = statSync3(full).mtimeMs;
    } catch {
      continue;
    }
    if (!best || mtime > best.mtime) {
      best = { sessionId: entry.slice(0, -".jsonl".length), transcript: full, mtime };
    }
  }
  return best && { sessionId: best.sessionId, transcript: best.transcript };
}
var MAX_ASSISTANT_CHARS = 600;
var MAX_ERROR_CHARS = 400;
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function clip(s, max) {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
function textOf(content) {
  if (typeof content === "string")
    return content.trim();
  if (!Array.isArray(content))
    return "";
  const parts = [];
  for (const block of content) {
    if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join(`
`).trim();
}
function errorOf(content) {
  if (!Array.isArray(content))
    return null;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result" || block.is_error !== true)
      continue;
    const body = block.content;
    return typeof body === "string" ? body : JSON.stringify(body);
  }
  return null;
}
function digestLine(raw) {
  if (!raw.trim())
    return null;
  let line;
  try {
    line = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(line))
    return null;
  if (line.isSidechain === true)
    return null;
  const ts = typeof line.timestamp === "string" ? line.timestamp : undefined;
  const message = isRecord(line.message) ? line.message : undefined;
  if (line.type === "user" && line.promptSource === "typed") {
    const text = textOf(message?.content);
    return text ? { kind: "user", text, ts } : null;
  }
  if (line.type === "assistant") {
    const text = textOf(message?.content);
    return text ? { kind: "assistant", text: clip(text, MAX_ASSISTANT_CHARS), ts } : null;
  }
  if (line.type === "user") {
    const err = errorOf(message?.content);
    return err ? { kind: "error", text: clip(err, MAX_ERROR_CHARS), ts } : null;
  }
  return null;
}
function dedupe(rows) {
  const out = [];
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
function resolveTranscript(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const explicit = opts.sessionId !== undefined;
  const sessionId = opts.sessionId ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;
  if (sessionId) {
    const direct = join4(claudeProjectDir(cwd), `${sessionId}.jsonl`);
    if (existsSync4(direct))
      return { transcript: direct, sessionId, missing: false };
    const root = claudeProjectsRoot();
    let dirs;
    try {
      dirs = readdirSync3(root);
    } catch {
      dirs = [];
    }
    for (const dir of dirs) {
      const candidate = join4(root, dir, `${sessionId}.jsonl`);
      if (existsSync4(candidate))
        return { transcript: candidate, sessionId, missing: false };
    }
    if (explicit)
      return { transcript: null, sessionId, missing: true };
  }
  const newest = newestSession(cwd);
  if (newest)
    return { ...newest, missing: false };
  return { transcript: null, sessionId, missing: false };
}
function gatherDigest(opts = {}) {
  const { transcript, sessionId, missing } = resolveTranscript(opts);
  const empty = {
    lines: 0,
    extracted: 0,
    deduped: 0,
    rawBytes: 0,
    digestBytes: 0
  };
  if (!transcript)
    return { transcript: null, sessionId, missing, rows: [], stats: empty };
  let raw;
  try {
    raw = readFileSync4(transcript, "utf8");
  } catch {
    return { transcript, sessionId, missing, rows: [], stats: empty };
  }
  const lines = raw.split(`
`);
  const extracted = [];
  for (const line of lines) {
    const row = digestLine(line);
    if (row)
      extracted.push(row);
  }
  const { rows: deduped, removed } = dedupe(extracted);
  const limited = opts.limit && opts.limit > 0 ? deduped.slice(-opts.limit) : deduped;
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
      digestBytes: limited.reduce((n, r) => n + Buffer.byteLength(r.text) + 8, 0)
    }
  };
}
var LABEL = {
  user: "USER",
  assistant: "ASST",
  error: "ERR "
};
function formatDigest(result) {
  const out = [];
  for (const row of result.rows) {
    out.push(`${LABEL[row.kind]}  ${row.text}`);
    out.push("");
  }
  return out.join(`
`);
}

// src/scaffold.ts
import { existsSync as existsSync5, readFileSync as readFileSync5, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join5 } from "node:path";
function normalizeTopicName(raw) {
  return raw.replace(/\.md$/i, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
var entryPath = (line) => {
  const m = line.match(/^\s*-\s+`?([\w./-]+\.md)`?/);
  return m ? m[1] : null;
};
function scaffoldTopic(root, rawName, rawTrigger, opts = {}) {
  const name = normalizeTopicName(rawName);
  if (!name)
    throw new Error(`name "${rawName}" normalizes to empty - pick an alphanumeric topic name`);
  const trigger = rawTrigger.replace(/^\s*use when:\s*/i, "").trim();
  if (!trigger)
    throw new Error('empty trigger - the index entry needs a concrete "Use when:" cue');
  const area = (opts.area ?? "").replace(/^context\//, "").split("/").map(normalizeTopicName).filter(Boolean).join("/");
  const dirRel = area ? `context/${area}` : "context";
  const indexRel = `${dirRel}/index.md`;
  const indexFile = join5(root, indexRel);
  if (!existsSync5(indexFile)) {
    throw new Error(area ? `no ${indexRel} under ${root} - create the area index and list it from a parent index first (scaffold adds INTO an existing index)` : `no context/index.md under ${root} - run the context-index skill's \`setup\` first (scaffold adds INTO an existing index)`);
  }
  const topicRel = `${dirRel}/${name}.md`;
  const topicFile = join5(root, topicRel);
  if (existsSync5(topicFile)) {
    throw new Error(`${topicRel} already exists - edit it directly or pick another name`);
  }
  const indexLines = readFileSync5(indexFile, "utf8").split(`
`);
  for (let i = 0;i < indexLines.length; i++) {
    if (entryPath(indexLines[i]) === topicRel) {
      throw new Error(`${indexRel} already has an entry for ${topicRel} (line ${i + 1}) - nothing to add`);
    }
  }
  const title = name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  const skeleton = `# ${title}

Use when: ${trigger}

## Overview

TODO: replace with the durable facts a new agent needs when this trigger fires - the
constraints, invariants, and "why" that aren't obvious from the code. Keep one concern per
section, self-contained, under 200 lines. Delete this TODO when filled.
`;
  const entryLine = `- \`${topicRel}\` - Use when: ${trigger}`;
  let insertAt = -1;
  let lastEntry = -1;
  for (let i = 0;i < indexLines.length; i++) {
    const p = entryPath(indexLines[i]);
    if (!p)
      continue;
    lastEntry = i;
    if (p.startsWith("context/"))
      insertAt = i;
  }
  if (insertAt === -1)
    insertAt = lastEntry;
  if (insertAt === -1) {
    const imp = indexLines.findIndex((l) => /^IMPORTANT:/.test(l.trimStart()));
    insertAt = imp > -1 ? imp + 1 : indexLines.length - 1;
  }
  indexLines.splice(insertAt + 1, 0, entryLine);
  writeFileSync2(topicFile, skeleton);
  writeFileSync2(indexFile, indexLines.join(`
`));
  return { name, topicRel, indexRel, entryLine, normalized: name !== rawName.replace(/\.md$/i, "") };
}

// src/cli.ts
var USAGE = `usage: context-index <command> [options]

Commands:
  ls                     List the index tree (path + trigger; sub-index entries indented)
  check                  Validate the CLAUDE.md + context/index.md corpus (exit 1 on error)
                           [--fix] relocate a misplaced @context/index.md import
                           [--ignore <a,b>] skip foreign paths (also reads .contextignore)
                           [--quiet] print errors only (for commit hooks and CI)
  scaffold <name> "<Use when trigger>"
                         New topic doc + wired index entry [--in <area>] [--no-check]
  footguns               Documented footguns to triage into fixes/checks [--limit N]
  gather                 Digest a Claude Code session transcript [--session <id>] [--limit N]

Options:
  --target <path>        Repo to operate on (default: the git toplevel of the cwd)
  --json                 Machine-readable output (ls, check, footguns, gather)`;
var VALUE_FLAGS = new Set(["--target", "--ignore", "--in", "--limit", "--session"]);
function parseArgs(argv) {
  const positionals = [];
  const flags = new Map;
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a : a.slice(0, eq);
    let value = eq === -1 ? "" : a.slice(eq + 1);
    if (eq === -1 && VALUE_FLAGS.has(name)) {
      const next = argv[i + 1];
      if (next === undefined)
        throw new Error(`${name} needs a value`);
      value = next;
      i++;
    }
    flags.set(name, [...flags.get(name) ?? [], value]);
  }
  return { positionals, flags };
}
var flag = (args, name) => args.flags.get(name)?.at(-1);
var has = (args, name) => args.flags.has(name);
var list = (args, name) => (args.flags.get(name) ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
function resolveRoot(target) {
  const start = resolve(target ?? process.cwd());
  let root = start;
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || start;
  } catch {}
  return existsSync6(root) ? realpathSync(root) : root;
}
var plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function runLs(root, json) {
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
  console.log(`
${plural(entries.length, "entry", "entries")}${indexes > 1 ? ` across ${indexes} indexes` : ""}`);
}
function runCheck(root, args, json) {
  const fix = has(args, "--fix");
  const result = checkContext(root, { fix, ignore: list(args, "--ignore") });
  const errs = result.findings.filter((f) => f.sev === "error").length;
  const warns = result.findings.length - errs;
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (fix && result.fixed > 0)
      console.log(`Applied ${plural(result.fixed, "autofix", "autofixes")}.`);
    if (result.ignored.files + result.ignored.dirs > 0) {
      console.log(`Ignored ${result.ignored.files} file(s) and ${result.ignored.dirs} path(s) via .contextignore / --ignore.`);
    }
    const shown = has(args, "--quiet") ? result.findings.filter((f) => f.sev === "error") : result.findings;
    const sorted = [...shown].sort((a, b) => a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1);
    for (const f of sorted) {
      console.log(`  ${f.sev === "error" ? "ERROR" : "warn "} ${f.file}${f.line ? `:${f.line}` : ""}  ${f.msg}`);
    }
    console.log(`
${plural(result.entries, "index entry", "index entries")}${result.indexes > 1 ? ` across ${result.indexes} indexes` : ""}; ${errs} error(s), ${warns} warning(s)`);
    if (errs > 0 && !fix) {
      console.log("Run with --fix to auto-correct mechanical violations, then resolve the rest by hand.");
    }
  }
  if (errs > 0)
    process.exitCode = 1;
}
function runScaffold(root, args) {
  const [name, trigger] = args.positionals.slice(1);
  if (!name || !trigger) {
    throw new Error('usage: context-index scaffold <name> "<Use when trigger>" [--in <area>] [--no-check]');
  }
  const res = scaffoldTopic(root, name, trigger, { area: flag(args, "--in") });
  if (res.normalized)
    console.log(`Normalized name -> "${res.name}" (single-word, lowercase, hyphenated).`);
  console.log(`Created ${res.topicRel}`);
  console.log(`Added entry to ${res.indexRel}: ${res.entryLine}`);
  if (has(args, "--no-check")) {
    console.log("Skipped validator (--no-check). Run `context-index check` before done.");
    return;
  }
  const errors = checkContext(root).findings.filter((f) => f.sev === "error");
  if (errors.length > 0) {
    console.log(`
Validator errors remain - the new file is written; resolve them before done:`);
    for (const f of errors)
      console.log(`  ERROR ${f.file}${f.line ? `:${f.line}` : ""}  ${f.msg}`);
    process.exitCode = 1;
  } else {
    console.log("\nValidator clean. Fill in the body, then re-run `context-index check`.");
  }
}
function parseLimit(args, fallback) {
  const raw = flag(args, "--limit");
  return raw === undefined ? fallback : Math.max(0, parseInt(raw, 10) || 0);
}
function runFootguns(root, args, json) {
  const limit = parseLimit(args, 40);
  const result = findFootguns(root, { ignore: list(args, "--ignore") });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Scanned ${result.scanned} file(s) under ${root}`);
  console.log(`Found ${result.total} documented footgun(s): ` + `A(invariant-no-guard)=${result.byCategory.A}  D(scriptable-procedure)=${result.byCategory.D}  B(gotcha-section)=${result.byCategory.B}  C(hazard-phrase)=${result.byCategory.C}`);
  if (!result.total)
    return;
  console.log(`
Run each through the "prefer the fix over the note" ladder: root-cause fix > harness check > keep as an anchored doc.`);
  const byFile = new Map;
  for (const f of result.findings)
    byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
  console.log(`
Top files:`);
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(n).padStart(3)}  ${f}`);
  }
  for (const c of ["A", "D", "B", "C"]) {
    const all = result.findings.filter((f) => f.cat === c);
    if (!all.length)
      continue;
    const shown = limit ? all.slice(0, limit) : all;
    console.log(`
[${c}] ${shown[0].category} - ${all.length} finding(s)${limit && all.length > limit ? ` (showing ${shown.length})` : ""}`);
    for (const f of shown)
      console.log(`  ${f.file}:${f.line}  ${f.text}`);
  }
}
function runGather(args, json) {
  const result = gatherDigest({ sessionId: flag(args, "--session"), limit: parseLimit(args, 0) });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.transcript) {
    if (result.missing)
      throw new Error(`no transcript for session "${result.sessionId}"`);
    console.log("No Claude Code transcript found ($CLAUDE_CODE_SESSION_ID is unset and this directory has no sessions).");
    console.log("Fall back to scanning the live context - degraded: a compacted session under-reports.");
    return;
  }
  const s = result.stats;
  const ratio = s.digestBytes > 0 ? Math.round(s.rawBytes / s.digestBytes) : 0;
  console.log(`# ${result.transcript}`);
  console.log(`# ${s.lines} line(s) -> ${result.rows.length} row(s); ${s.deduped} duplicate(s) collapsed; ${ratio}x smaller than raw
`);
  console.log(formatDigest(result));
}
function main(argv) {
  const args = parseArgs(argv);
  const cmd = args.positionals[0];
  const json = has(args, "--json");
  if (cmd === undefined || cmd === "help" || has(args, "--help")) {
    console.log(USAGE);
    return;
  }
  if (cmd === "gather")
    return runGather(args, json);
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
    default:
      throw new Error(`unknown command "${cmd}"

${USAGE}`);
  }
}

// src/bin.ts
try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`context-index: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
}
