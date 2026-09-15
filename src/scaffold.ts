import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ScaffoldResult {
  /** The normalized topic name (single-word, lowercase, hyphenated). */
  name: string;
  /** Repo-relative path of the created topic doc. */
  topicRel: string;
  /** Repo-relative path of the index that received the entry. */
  indexRel: string;
  /** The index entry line that was inserted. */
  entryLine: string;
  /** True if the name was rewritten from the caller's input. */
  normalized: boolean;
}

// Normalize a topic name to the single-word, lowercase, hyphenated form the doctrine mandates
// (camelCase/snake/space -> kebab). Enforced here so `featureFlags` can never reach disk.
export function normalizeTopicName(raw: string): string {
  return raw
    .replace(/\.md$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const entryPath = (line: string): string | null => {
  const m = line.match(/^\s*-\s+`?([\w./-]+\.md)`?/);
  return m ? m[1] : null;
};

export interface ScaffoldOptions {
  /** Area under context/ whose sub-index receives the entry (`payments` ->
   * context/payments/index.md). Omit for the root context/index.md. The index must exist. */
  area?: string;
}

// Create a `context/[<area>/]<name>.md` skeleton AND insert its entry into the owning index in
// one deterministic step, so the wiring (bare path, "Use when:" trigger, no orphan, no dangling
// pointer) is GENERATED, not hand-typed. The caller supplies the trigger words and fills the
// body; the structure is guaranteed. Throws on any refusal (no index, file/entry exists, empty
// input). Does NOT run the validator - the CLI orchestrates that after.
export function scaffoldTopic(root: string, rawName: string, rawTrigger: string, opts: ScaffoldOptions = {}): ScaffoldResult {
  const name = normalizeTopicName(rawName);
  if (!name) throw new Error(`name "${rawName}" normalizes to empty - pick an alphanumeric topic name`);

  const trigger = rawTrigger.replace(/^\s*use when:\s*/i, "").trim();
  if (!trigger) throw new Error("empty trigger - the index entry needs a concrete \"Use when:\" cue");

  const area = (opts.area ?? "")
    .replace(/^context\//, "")
    .split("/")
    .map(normalizeTopicName)
    .filter(Boolean)
    .join("/");
  const dirRel = area ? `context/${area}` : "context";
  const indexRel = `${dirRel}/index.md`;
  const indexFile = join(root, indexRel);
  if (!existsSync(indexFile)) {
    throw new Error(area
      ? `no ${indexRel} under ${root} - create the area index and list it from a parent index first (scaffold adds INTO an existing index)`
      : `no context/index.md under ${root} - create it first with a "# Context index" title and an IMPORTANT directive line (scaffold adds entries INTO an existing index)`);
  }

  const topicRel = `${dirRel}/${name}.md`;
  const topicFile = join(root, topicRel);
  if (existsSync(topicFile)) {
    throw new Error(`${topicRel} already exists - edit it directly or pick another name`);
  }

  const indexLines = readFileSync(indexFile, "utf8").split("\n");
  for (let i = 0; i < indexLines.length; i++) {
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
  for (let i = 0; i < indexLines.length; i++) {
    const p = entryPath(indexLines[i]);
    if (!p) continue;
    lastEntry = i;
    if (p.startsWith("context/")) insertAt = i; // last context/ entry wins
  }
  if (insertAt === -1) insertAt = lastEntry; // no context/ entries yet -> after last entry
  if (insertAt === -1) {
    const imp = indexLines.findIndex((l) => /^IMPORTANT:/.test(l.trimStart()));
    insertAt = imp > -1 ? imp + 1 : indexLines.length - 1;
  }
  indexLines.splice(insertAt + 1, 0, entryLine);

  writeFileSync(topicFile, skeleton);
  writeFileSync(indexFile, indexLines.join("\n"));

  return { name, topicRel, indexRel, entryLine, normalized: name !== rawName.replace(/\.md$/i, "") };
}
