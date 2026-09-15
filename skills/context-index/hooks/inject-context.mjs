#!/usr/bin/env node
// context-index injection hook (PreToolUse: Edit|Write). Zero deps (Node stdlib only).
//
// When the agent edits a file matching an index entry's `paths:` glob, this surfaces that
// topic doc's `## Inject` section (or its head, capped) as additionalContext - so the relevant
// convention rides into context at edit time instead of relying on the agent recognizing it
// should read the doc.
//
// OPT-IN BY INDEX AUTHORING: it is a no-op for any repo whose index tree (context/index.md and
// every context/<area>/index.md it lists) has no entry carrying a `; paths: ...` glob. Add `paths:` globs to an entry to activate it; add a
// `## Inject` section to that topic doc to control exactly what gets surfaced.
//
// Read-only. Fail-safe: ANY error -> exit 0, no output, never blocks the edit.
//
// CAVEAT: PreToolUse additionalContext reaches the model on its NEXT request - it informs
// subsequent edits in a multi-file task, not the triggering edit itself. It never blocks.

import { readFileSync, existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";

const MAX_DOCS = 4; // matched docs that get a full injected section
const MAX_LINES = 40; // lines per section (dilution control - prefer a `## Inject` block)

// Minimal glob -> RegExp (repo-relative path). Handles **, **/, *, ? - no brace expansion.
// `*` stays within a segment; `**` crosses `/`. Mirrors globToRegExp in the context-index checker.
function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; out += "(?:[^/]*/)*"; }
        else out += ".*";
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += /[.+^${}()|[\]\\]/.test(c) ? "\\" + c : c;
    }
  }
  return new RegExp("^" + out + "$");
}

// Parse context/index.md entries, keeping only those with `; paths: ...` globs.
// Mirrors parseIndexEntries in the context-index checker (the glob-bearing subset).
function pathScopedEntries(text) {
  const out = [];
  text.split("\n").forEach((line) => {
    const bullet = line.match(/^\s*-\s+(.*)$/);
    if (!bullet) return;
    const body = bullet[1];
    const pathMatch = body.match(/`?([\w./-]+\.md)`?/);
    if (!pathMatch) return;
    const pm = body.match(/;\s*paths:\s*(.+)$/i);
    if (!pm) return;
    const globs = [...pm[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (globs.length) out.push({ path: pathMatch[1], globs });
  });
  return out;
}

// Sub-index paths an index lists (`context/<area>/index.md`). Mirrors isIndexPath in the context-index checker.
function subIndexPaths(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const bullet = line.match(/^\s*-\s+(.*)$/);
    const pathMatch = bullet && bullet[1].match(/`?([\w./-]+\.md)`?/);
    if (pathMatch && /^context\/(?:[^/]+\/)*index\.md$/.test(pathMatch[1])) out.push(pathMatch[1]);
  }
  return out;
}

// Path-scoped entries from context/index.md and every sub-index it lists, depth-first, each
// index once - the same tree `context-index check` walks.
function collectPathScopedEntries(projectDir) {
  const out = [];
  const seen = new Set();
  const visit = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const file = join(projectDir, rel);
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    out.push(...pathScopedEntries(text));
    for (const sub of subIndexPaths(text)) visit(sub);
  };
  visit("context/index.md");
  return out;
}

function injectSection(docText, docPath) {
  const lines = docText.split("\n");
  const start = lines.findIndex((l) => /^##\s+inject\b/i.test(l));
  let body;
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && !/^##\s+/.test(lines[end])) end++;
    body = lines.slice(start + 1, end);
  } else {
    body = lines;
  }
  body = body.join("\n").trim().split("\n");
  return body.length > MAX_LINES
    ? body.slice(0, MAX_LINES).join("\n") + `\n...(truncated - read ${docPath})`
    : body.join("\n");
}

function main() {
  let input = "";
  try { input = readFileSync(0, "utf8"); } catch { return; }
  if (!input.trim()) return;

  let json;
  try { json = JSON.parse(input); } catch { return; }
  const fp = json && json.tool_input && json.tool_input.file_path;
  if (!fp) return;

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let rel = isAbsolute(fp) ? relative(projectDir, fp) : fp;
  rel = rel.split("\\").join("/");
  if (rel.startsWith("../")) return; // outside the project
  // Skip self-referential edits (the docs / index / any CLAUDE.md).
  if (rel.startsWith("context/") || rel === "CLAUDE.md" || rel.endsWith("/CLAUDE.md")) return;

  const entries = collectPathScopedEntries(projectDir);
  if (!entries.length) return; // no path-scoped entries anywhere in the index tree -> dormant

  const matched = entries.filter((e) =>
    e.globs.some((g) => { try { return globToRegExp(g).test(rel); } catch { return false; } }));
  if (!matched.length) return;

  const blocks = [];
  for (const e of matched.slice(0, MAX_DOCS)) {
    const docFile = join(projectDir, e.path);
    if (existsSync(docFile)) blocks.push(`-- ${e.path} --\n${injectSection(readFileSync(docFile, "utf8"), e.path)}`);
  }
  if (!blocks.length) return;

  const overflow = matched.slice(MAX_DOCS).map((e) => e.path);
  let ctx = `context-index: editing \`${rel}\` matches indexed guidance - apply before continuing:\n\n${blocks.join("\n\n")}`;
  if (overflow.length) ctx += `\n\nAlso relevant: ${overflow.join(", ")}`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx },
  }));
}

try { main(); } catch { /* fail-safe: never break the agent's edit */ }
