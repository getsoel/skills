import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkContext, loadIndexEntries, loadIndexTree } from "./check";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "context-"));
  mkdirSync(join(root, "context"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const errs = (r: { findings: { file: string; sev: string; msg: string }[] }) => r.findings.filter((f) => f.sev === "error");

test("a clean corpus passes", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n\n- `context/auth.md` - Use when: touching auth\n");
  writeFileSync(join(root, "context", "auth.md"), "# Auth\n\nStuff.\n");
  expect(errs(checkContext(root))).toHaveLength(0);
});

test("an orphan topic doc is an error", () => {
  writeFileSync(join(root, "CLAUDE.md"), "@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n");
  writeFileSync(join(root, "context", "stray.md"), "# Stray\n");
  expect(errs(checkContext(root)).some((f) => f.msg.includes("not referenced"))).toBe(true);
});

test("a dangling index pointer is an error", () => {
  writeFileSync(join(root, "CLAUDE.md"), "@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "- `context/gone.md` - Use when: never\n");
  expect(errs(checkContext(root)).some((f) => f.msg.includes("missing file"))).toBe(true);
});

test("an eager @ entry and a missing trigger are errors", () => {
  writeFileSync(join(root, "CLAUDE.md"), "@context/index.md\n");
  writeFileSync(join(root, "context", "a.md"), "# A\n");
  writeFileSync(join(root, "context", "index.md"), "- `@context/a.md`\n");
  const e = errs(checkContext(root));
  expect(e.some((f) => f.msg.includes("eager"))).toBe(true);
  expect(e.some((f) => f.msg.includes("no \"Use when:\""))).toBe(true);
});

test("root CLAUDE.md missing the index import is an error", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\nno import here\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n");
  expect(errs(checkContext(root)).some((f) => f.msg.includes("@context/index.md"))).toBe(true);
});

test("loadIndexEntries parses paths and triggers", () => {
  writeFileSync(join(root, "context", "index.md"), "- `context/auth.md` - Use when: touching auth\n");
  const entries = loadIndexEntries(root);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.path).toBe("context/auth.md");
  expect(entries[0]!.trigger).toBe("touching auth");
});

test(".contextignore skips foreign instruction files", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n");
  mkdirSync(join(root, "_legacy"));
  writeFileSync(join(root, "_legacy", "CLAUDE.md"), "# legacy ✓ glyph\n");
  expect(checkContext(root).findings.some((f) => f.file.includes("_legacy"))).toBe(true);

  writeFileSync(join(root, ".contextignore"), "_legacy\n");
  const r = checkContext(root);
  expect(r.findings.some((f) => f.file.includes("_legacy"))).toBe(false);
  expect(r.ignored.dirs).toBe(1);
});

test("--ignore skips a one-off path too", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n");
  mkdirSync(join(root, "vendor"));
  writeFileSync(join(root, "vendor", "CLAUDE.md"), "# vendor ❌ glyph\n");
  const r = checkContext(root, { ignore: ["vendor"] });
  expect(r.findings.some((f) => f.file.includes("vendor"))).toBe(false);
});

test("--fix relocates a misplaced @context/index.md import to the last line", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n\n## More\n\ntrailing content\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n");
  expect(checkContext(root).findings.some((f) => f.msg.includes("should be the last line"))).toBe(true);

  const fixed = checkContext(root, { fix: true });
  expect(fixed.fixed).toBe(1);
  expect(readFileSync(join(root, "CLAUDE.md"), "utf8").trimEnd().endsWith("@context/index.md")).toBe(true);
  expect(checkContext(root).findings.some((f) => f.msg.includes("should be the last line"))).toBe(false);
});

test("triggers sharing distinctive keywords warn about ambiguous routing", () => {
  writeFileSync(join(root, "CLAUDE.md"), "@context/index.md\n");
  writeFileSync(join(root, "context", "a.md"), "# A\n\nwidget frobnicator content\n");
  writeFileSync(join(root, "context", "b.md"), "# B\n\nwidget frobnicator content\n");
  writeFileSync(
    join(root, "context", "index.md"),
    "# Index\n\n- `context/a.md` - Use when: widget frobnicator alpha\n- `context/b.md` - Use when: widget frobnicator bravo\n",
  );
  expect(checkContext(root).findings.some((f) => f.msg.includes("triggers overlap"))).toBe(true);
});

test("a trigger whose keywords are absent from the doc warns about drift", () => {
  writeFileSync(join(root, "CLAUDE.md"), "@context/index.md\n");
  writeFileSync(join(root, "context", "auth.md"), "# Auth\n\nUnrelated prose about widgets.\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n\n- `context/auth.md` - Use when: kerberos saml oauth ldap\n");
  expect(checkContext(root).findings.some((f) => f.msg.includes("trigger keywords appear"))).toBe(true);
});

test("a dated verification claim with no nearby anchor warns", () => {
  writeFileSync(join(root, "CLAUDE.md"), "@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n\n- `context/env.md` - Use when: env topology deploy cluster\n");
  writeFileSync(join(root, "context", "env.md"), "# Env\n\nProd verified 2026-06-22 on the cluster.\n");
  expect(checkContext(root).findings.some((f) => f.msg.includes("dated state claim"))).toBe(true);
});

test("a fenced code block in CLAUDE.md warns; a topic doc is exempt", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n```ts\nconst x = 1;\n```\n\n@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n\n- `context/t.md` - Use when: touching the thing widget\n");
  writeFileSync(join(root, "context", "t.md"), "# T\n\nProse about the thing widget.\n\n```ts\nexample();\n```\n");
  const fenced = checkContext(root).findings.filter((f) => f.msg.includes("fenced code block"));
  expect(fenced.some((f) => f.file === "CLAUDE.md")).toBe(true);
  expect(fenced.some((f) => f.file.includes("t.md"))).toBe(false);
});

// Nested indexes: the root index lists `context/<area>/index.md`, which lists that area's docs.

function nested(): void {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n");
  mkdirSync(join(root, "context", "payments"));
  writeFileSync(join(root, "context", "index.md"), "# Index\n\n- `context/payments/index.md` - Use when: payments ledger stripe webhooks\n");
  writeFileSync(
    join(root, "context", "payments", "index.md"),
    "# Payments\n\n- `context/payments/ledger.md` - Use when: ledger postings\n- `context/payments/stripe.md` - Use when: stripe webhooks\n",
  );
  writeFileSync(join(root, "context", "payments", "ledger.md"), "# Ledger\n\nledger postings.\n");
  writeFileSync(join(root, "context", "payments", "stripe.md"), "# Stripe\n\nstripe webhooks.\n");
}

test("nested: a root index -> area index -> docs corpus passes", () => {
  nested();
  expect(errs(checkContext(root))).toHaveLength(0);
});

test("nested: a doc in an area dir that no index lists is an orphan", () => {
  nested();
  writeFileSync(join(root, "context", "payments", "stray.md"), "# Stray\n");
  const e = errs(checkContext(root));
  expect(e.some((f) => f.file === "context/payments/stray.md" && f.msg.includes("not referenced"))).toBe(true);
});

test("nested: an area index the root never lists is an orphan, and so are its docs", () => {
  nested();
  mkdirSync(join(root, "context", "lost"));
  writeFileSync(join(root, "context", "lost", "index.md"), "- `context/lost/doc.md` - Use when: lost things\n");
  writeFileSync(join(root, "context", "lost", "doc.md"), "# Doc\n");
  const files = errs(checkContext(root)).filter((f) => f.msg.includes("not referenced")).map((f) => f.file);
  expect(files).toContain("context/lost/index.md");
  expect(files).toContain("context/lost/doc.md");
});

test("nested: sub-index entries get the same entry rules as the root index", () => {
  nested();
  writeFileSync(
    join(root, "context", "payments", "index.md"),
    "- `context/payments/ledger.md` - Use when: ledger postings\n- `context/payments/stripe.md`\n- `context/payments/gone.md` - Use when: never\n- `@context/payments/ledger.md` - Use when: eager\n",
  );
  const e = errs(checkContext(root)).filter((f) => f.file === "context/payments/index.md");
  expect(e.some((f) => f.msg.includes('no "Use when:"'))).toBe(true);
  expect(e.some((f) => f.msg.includes("missing file"))).toBe(true);
  expect(e.some((f) => f.msg.includes("eager"))).toBe(true);
});

test("nested: orphan matching uses the full path, not the file name", () => {
  nested();
  // The root lists a NESTED stripe.md directly; a different top-level stripe.md must not ride on it.
  writeFileSync(
    join(root, "context", "index.md"),
    "# Index\n\n- `context/payments/index.md` - Use when: payments ledger stripe webhooks\n- `context/payments/stripe.md` - Use when: stripe webhooks\n",
  );
  writeFileSync(join(root, "context", "stripe.md"), "# A different stripe doc\n");
  expect(errs(checkContext(root)).some((f) => f.file === "context/stripe.md" && f.msg.includes("not referenced"))).toBe(true);
});

test("nested: an index that lists an ancestor index terminates with a warning", () => {
  nested();
  writeFileSync(
    join(root, "context", "payments", "index.md"),
    "- `context/payments/ledger.md` - Use when: ledger postings\n- `context/payments/stripe.md` - Use when: stripe webhooks\n- `context/index.md` - Use when: back to the top\n",
  );
  expect(checkContext(root).findings.some((f) => f.msg.includes("already reached"))).toBe(true);
});

test("nested: the entry soft cap and trigger overlap apply per index", () => {
  nested();
  const lines: string[] = [];
  for (let i = 0; i < 21; i++) {
    lines.push(`- \`context/payments/d${i}.md\` - Use when: topic${i} alpha${i} beta${i}`);
    writeFileSync(join(root, "context", "payments", `d${i}.md`), `# D${i}\n\ntopic${i} alpha${i} beta${i}\n`);
  }
  lines.push(
    "- `context/payments/ledger.md` - Use when: widget frobnicator ledger",
    "- `context/payments/stripe.md` - Use when: widget frobnicator stripe",
  );
  writeFileSync(join(root, "context", "payments", "index.md"), lines.join("\n") + "\n");
  const sub = checkContext(root).findings.filter((f) => f.file === "context/payments/index.md");
  expect(sub.some((f) => f.msg.includes("soft cap"))).toBe(true);
  expect(sub.some((f) => f.msg.includes("triggers overlap"))).toBe(true);
});

test("nested: identical bodies are caught across area dirs", () => {
  nested();
  writeFileSync(join(root, "context", "payments", "stripe.md"), "# Ledger\n\nledger postings.\n");
  expect(errs(checkContext(root)).some((f) => f.msg.includes("identical body"))).toBe(true);
});

test("nested: entries counts the whole tree, and a sub-index is checked as an index file", () => {
  nested();
  writeFileSync(
    join(root, "context", "payments", "index.md"),
    "- `context/payments/ledger.md` - Use when: ledger postings\n- `context/payments/stripe.md` - Use when: stripe webhooks\n\n```\nsnippet\n```\n",
  );
  const r = checkContext(root);
  expect(r.entries).toBe(3);
  expect(r.indexes).toBe(2);
  expect(r.findings.some((f) => f.file === "context/payments/index.md" && f.msg.includes("fenced code block"))).toBe(true);
});

test("loadIndexTree flattens nested entries and names the index each came from", () => {
  nested();
  expect(loadIndexTree(root).map((e) => [e.index, e.path, e.depth])).toEqual([
    ["context/index.md", "context/payments/index.md", 0],
    ["context/payments/index.md", "context/payments/ledger.md", 1],
    ["context/payments/index.md", "context/payments/stripe.md", 1],
  ]);
});
