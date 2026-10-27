#!/usr/bin/env node
// context-index doc-edit hook (PostToolUse: Edit|Write). Zero deps (Node stdlib only).
//
// When the agent edits an agent doc - a CLAUDE.md or anything under context/ - this runs the
// bundled checker on that one file and hands its findings back as additionalContext: a path
// that no longer exists, a sentence another doc already states, a budget overrun, a dated
// claim with no anchor. Most doc edits happen mid-task with the skill not loaded, so this is
// what keeps the skill's rules in force at the moment a doc is written.
//
// Read-only. Fail-safe: ANY error -> exit 0, no output. Never blocks; silent when the file
// is clean.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FINDINGS = 12;
const TIMEOUT_MS = 8000;

const isAgentDoc = (rel) =>
  (rel.startsWith("context/") && rel.endsWith(".md")) || rel === "CLAUDE.md" || rel.endsWith("/CLAUDE.md");

function main() {
  let input = "";
  try { input = readFileSync(0, "utf8"); } catch { return; }
  if (!input.trim()) return;

  let json;
  try { json = JSON.parse(input); } catch { return; }
  const fp = json && json.tool_input && json.tool_input.file_path;
  if (!fp) return;

  const projectDir = process.env.CLAUDE_PROJECT_DIR || json.cwd || process.cwd();
  const rel = (isAbsolute(fp) ? relative(projectDir, fp) : fp).split("\\").join("/");
  if (rel.startsWith("../") || !isAgentDoc(rel)) return;

  const checker = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "context-index.mjs");
  if (!existsSync(checker)) return;

  let result;
  try {
    const out = execFileSync(process.execPath, [checker, "check", "--json", "--target", projectDir, "--file", rel], {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    result = JSON.parse(out);
  } catch (err) {
    // check exits 1 when errors remain; its JSON is still on stdout.
    try { result = JSON.parse(err.stdout); } catch { return; }
  }
  const findings = (result && result.findings) || [];
  if (!findings.length) return;

  const shown = findings
    .slice()
    .sort((a, b) => (a.sev === b.sev ? a.line - b.line : a.sev === "error" ? -1 : 1))
    .slice(0, MAX_FINDINGS)
    .map((f) => `- ${f.sev === "error" ? "ERROR " : ""}${rel}${f.line ? `:${f.line}` : ""} ${f.msg}`);
  const more = findings.length > MAX_FINDINGS ? `\n- ...and ${findings.length - MAX_FINDINGS} more (\`context-index check --file ${rel}\`)` : "";
  const ctx =
    `context-index: \`${rel}\` is an agent doc. The checker found:\n${shown.join("\n")}${more}\n\n` +
    "Fix what this edit introduced or touched (point to the doc that owns a duplicated rule instead of restating it; " +
    "correct or drop a dead path). Leave unrelated findings unless the user asked for cleanup.";

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: ctx },
  }));
}

try { main(); } catch { /* fail-safe: never break the agent's edit */ }
