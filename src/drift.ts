// Drift checks: prose that has fallen out of step with the repo or with its sibling docs.
// Both are heuristics - they report warnings for review, never errors - because the corpus is
// written for humans and a path or sentence can be quoted on purpose.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

type AddFn = (file: string, line: number, sev: "error" | "warn", msg: string) => void;

interface Seg {
  code: boolean;
  text: string;
}

// Inline-code spans vs prose on one line (mirrors segments() in check.ts).
function segments(line: string): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  while (i < line.length) {
    const tick = line.indexOf("`", i);
    if (tick === -1) { out.push({ code: false, text: line.slice(i) }); break; }
    if (tick > i) out.push({ code: false, text: line.slice(i, tick) });
    const end = line.indexOf("`", tick + 1);
    if (end === -1) { out.push({ code: false, text: line.slice(tick) }); break; }
    out.push({ code: true, text: line.slice(tick + 1, end) });
    i = end + 1;
  }
  return out;
}

// Lines outside fenced code blocks, with their 1-based numbers.
function proseLines(text: string): Array<{ n: number; line: string }> {
  const out: Array<{ n: number; line: string }> = [];
  let inFence = false;
  text.split("\n").forEach((line, i) => {
    const tok = line.trimStart().slice(0, 3);
    if (tok === "```" || tok === "~~~") { inFence = !inFence; return; }
    if (!inFence) out.push({ n: i + 1, line });
  });
  return out;
}

// --- dead paths -------------------------------------------------------------------------

// A repo path inside a code span: two or more segments, optional ./ or ../ prefix. Templates,
// globs, and variables (<id>, *, {a,b}, $VAR) are not concrete paths and never match.
const PATH_TOKEN = /(?:^|[\s'"(=,:])((?:\.\.?\/)?[\w.@-]+(?:\/[\w.@-]+)+\/?)(?=$|[\s'"),;:])/g;
const LINE_SUFFIX = /(?::\d+(?:-\d+)?)+$/;

// A sentence that says the path is gone names it on purpose ("there is no `apps/web`",
// "a rewrite of `x.ts`", "`git grep ...` returns nothing").
const GONE = /\b(?:no|removed|deleted|gone|retired|dropped|renamed|replaced|formerly|previously|used to|no longer|rewrite of|returns nothing|finds nothing|no hits|instead of|generated)\b/i;

/** Repo-relative paths a doc line names in code spans, as written (line suffixes dropped). */
export function pathRefs(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+(?=[A-Z`*(])/)
    .filter((sentence) => !GONE.test(segments(sentence).filter((s) => !s.code).map((s) => s.text).join("")))
    .flatMap(sentencePathRefs);
}

function sentencePathRefs(line: string): string[] {
  const out: string[] = [];
  for (const seg of segments(line)) {
    if (!seg.code || /[*?<>{}$\[\]]|\.\.\./.test(seg.text)) continue;
    for (const m of seg.text.matchAll(PATH_TOKEN)) {
      const raw = m[1]!.replace(LINE_SUFFIX, "").replace(/[.,]+$/, "");
      if (raw.startsWith("@") || /^[\w.-]+\.[a-z]{2,}\//i.test(raw)) continue; // npm scope, a domain
      // `./types` is an import specifier, not a pointer a reader follows.
      if (/^\.\.?\//.test(raw) && !raw.endsWith("/") && !/\.\w+$/.test(raw.split("/").pop()!)) continue;
      out.push(raw);
    }
  }
  return out;
}

// Where a reader might look for a reference: ./ and ../ against the doc's directory (and ./
// against the root too - commands are run from there), a bare path against the root, or
// against the doc's directory when the first segment is the doc's sibling (`orgs/x.json`
// inside packages/cli/provision/...). Empty when the reference does not look like it names
// this repo at all (its first segment is nowhere nearby), which keeps API routes, other
// repos' paths, and bucket keys out of the report.
function candidates(root: string, docDir: string, ref: string): string[] {
  const clean = ref.replace(/\/$/, "");
  if (clean.startsWith("../")) return [relative(root, join(docDir, clean))];
  if (clean.startsWith("./")) return [relative(root, join(docDir, clean)), clean.slice(2)];
  const first = clean.split("/")[0]!;
  const out: string[] = [];
  if (existsSync(join(root, first))) out.push(clean);
  if (existsSync(join(docDir, first))) out.push(relative(root, join(docDir, clean)));
  return out;
}

// A module specifier names a file without its extension (`src/types/http`).
const MODULE_EXT = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".d.ts", "/index.ts", "/index.js"];
const exists = (root: string, rel: string): boolean => MODULE_EXT.some((ext) => existsSync(join(root, rel + ext)));

// Paths git would ignore (build output, local notes) legitimately do not exist in a clean
// checkout. `git check-ignore` answers that exactly, nonexistent paths included; outside git
// nothing is filtered.
function gitIgnored(root: string, paths: string[]): Set<string> {
  if (!paths.length) return new Set();
  try {
    const out = execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
      cwd: root,
      input: paths.join("\n") + "\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return new Set(out.split("\n").filter(Boolean));
  } catch (err) {
    // Exit 1 = none ignored; anything else (no git, not a repo) = cannot tell.
    const stdout = (err as { stdout?: string }).stdout;
    return new Set(typeof stdout === "string" ? stdout.split("\n").filter(Boolean) : []);
  }
}

// Every tracked file and directory, for recognizing a path written relative to a package
// (`services/viewer/x.ts` for `services/api/src/services/viewer/x.ts`). Null outside git.
function trackedPaths(root: string): string[] | null {
  try {
    const files = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean);
    const all = new Set(files);
    for (const f of files) {
      for (let i = f.indexOf("/"); i !== -1; i = f.indexOf("/", i + 1)) all.add(f.slice(0, i));
    }
    return [...all];
  } catch {
    return null;
  }
}

/** Warn on code-span paths that name nothing in the repo. */
export function checkDeadPaths(root: string, files: string[], add: AddFn): void {
  const missing: Array<{ file: string; n: number; ref: string; rel: string }> = [];
  for (const file of files) {
    const docDir = dirname(file);
    for (const { n, line } of proseLines(readFileSync(file, "utf8"))) {
      for (const ref of pathRefs(line)) {
        if (/(?:^|\/)path\/to\//.test(ref)) continue; // a placeholder
        const rels = candidates(root, docDir, ref).filter((r) => !r.startsWith(".."));
        if (!rels.length || rels.some((r) => exists(root, r))) continue;
        missing.push({ file, n, ref, rel: rels[0]! });
      }
    }
  }
  // A directory pattern (`lib/`) only matches a path git knows is a directory, so ask both ways.
  const ignored = gitIgnored(root, [...new Set(missing.flatMap((m) => [m.rel, m.rel + "/"]))]);
  const tracked = missing.length ? trackedPaths(root) : null;
  const abbreviation = new Map<string, boolean>();
  const isAbbreviation = (ref: string): boolean => {
    const tail = "/" + ref.replace(/^(?:\.\.?\/)+/, "").replace(/\/$/, "");
    if (!abbreviation.has(tail)) {
      let found = tracked?.some((p) => p.endsWith(tail)) ?? false;
      if (!found && tracked) {
        // Written relative to a package whose copy of the path is gitignored (`e2e/.auth/x.json`
        // under apps/<app>/): ask git about each package that has the first segment.
        const head = "/" + tail.split("/")[1]!;
        const alts = tracked.filter((p) => p.endsWith(head)).map((p) => p.slice(0, -head.length) + tail);
        const ig = gitIgnored(root, alts.flatMap((a) => [a, a + "/"]));
        found = alts.some((a) => ig.has(a) || ig.has(a + "/"));
      }
      abbreviation.set(tail, found);
    }
    return abbreviation.get(tail)!;
  };
  const seen = new Set<string>();
  for (const m of missing) {
    if (ignored.has(m.rel) || ignored.has(m.rel + "/") || isAbbreviation(m.ref)) continue;
    const key = `${m.file}:${m.n}:${m.rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add(m.file, m.n, "warn", `\`${m.ref}\` does not exist -> point at where it lives now, or drop the reference`);
  }
}

// --- duplicated sentences across docs -----------------------------------------------------

const MIN_WORDS = 10;

// Compare sentences by words, not markup: a copy that only re-wraps, re-bullets, or drops
// backticks/bold is still a copy.
function normalize(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[`*_>#|]/g, " ")
    .replace(/[^\p{L}\p{N}\s./:@-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:]+$/, "");
}

// A sentence that routes to a doc is the cure for duplication, not a case of it: sibling docs
// sharing "the map is `context/x.md`" is fine.
const POINTER = /`(?:\.\/)?context\/[^`]+\.md`|`[^`]*CLAUDE\.md`/;

/** Sentences of a doc line long enough to be a rule, normalized for comparison. */
export function ruleSentences(line: string): string[] {
  const body = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^#+\s.*$/, "");
  return body
    .split(/(?<=[.!?])\s+(?=[A-Z`*(])/)
    .filter((s) => !POINTER.test(s))
    .map(normalize)
    .filter((s) => s.split(" ").length >= MIN_WORDS);
}

/** Warn when a rule sentence appears word for word in another doc: the copies drift apart. */
export function checkCrossFileDuplicates(root: string, files: string[], add: AddFn): void {
  const where = new Map<string, Array<{ file: string; n: number }>>();
  for (const file of files) {
    for (const { n, line } of proseLines(readFileSync(file, "utf8"))) {
      for (const s of ruleSentences(line)) {
        const list = where.get(s) ?? [];
        if (!list.some((w) => w.file === file)) list.push({ file, n });
        where.set(s, list);
      }
    }
  }
  const flagged = new Set<string>();
  for (const list of where.values()) {
    if (list.length < 2) continue;
    for (const w of list) {
      const others = list.filter((o) => o !== w).map((o) => `${relative(root, o.file)}:${o.n}`);
      const key = `${w.file}:${w.n}:${others.join(",")}`;
      if (flagged.has(key)) continue;
      flagged.add(key);
      add(w.file, w.n, "warn", `same sentence as ${others.join(", ")} -> keep it in one doc and point to it from the other`);
    }
  }
}

// --- dead symbols (opt-in: reads every tracked source file) ------------------------------

// A code identifier a reader would grep for: camelCase with an inner capital, or PascalCase
// with two or more humps. ALL_CAPS names are left out - they are mostly env vars and error
// codes owned by other systems.
const SYMBOL = /^(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*)$/;
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|json|ya?ml|cue|sql|sh|py|go|rs|rb|java|kt|swift|css|scss|html|vue|svelte|toml|graphql)$/;
const MAX_SOURCE_BYTES = 2_000_000;

/** Backticked identifiers a doc line names, minus sentences that say the name is gone. */
export function symbolRefs(line: string): string[] {
  const out: string[] = [];
  for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z`*(])/)) {
    const segs = segments(sentence);
    if (GONE.test(segs.filter((s) => !s.code).map((s) => s.text).join(""))) continue;
    for (const seg of segs) {
      const name = seg.code ? seg.text.replace(/\(\)$/, "") : "";
      if (name.length >= 6 && SYMBOL.test(name)) out.push(name);
    }
  }
  return out;
}

// Every identifier in the repo's tracked source files. Null outside git.
function sourceIdentifiers(root: string): Set<string> | null {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter((f) => SOURCE_EXT.test(f));
  } catch {
    return null;
  }
  const ids = new Set<string>();
  for (const f of files) {
    let text: string;
    try {
      const p = join(root, f);
      if (statSync(p).size > MAX_SOURCE_BYTES) continue;
      text = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/[A-Za-z_$][\w$]{5,}/g)) ids.add(m[0]);
  }
  return ids;
}

/** Warn on backticked code identifiers that appear in no tracked source file. */
export function checkDeadSymbols(root: string, files: string[], add: AddFn): void {
  const refs: Array<{ file: string; n: number; name: string }> = [];
  for (const file of files) {
    for (const { n, line } of proseLines(readFileSync(file, "utf8"))) {
      for (const name of symbolRefs(line)) refs.push({ file, n, name });
    }
  }
  if (!refs.length) return;
  const ids = sourceIdentifiers(root);
  if (!ids) return;
  const seen = new Set<string>();
  for (const r of refs) {
    const key = `${r.file}:${r.n}:${r.name}`;
    if (ids.has(r.name) || seen.has(key)) continue;
    seen.add(key);
    add(r.file, r.n, "warn", `\`${r.name}\` appears in no tracked source file -> renamed or removed? Update the doc (or it names another system's API)`);
  }
}
