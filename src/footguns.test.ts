import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFootguns } from "./footguns";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "footguns-"));
  mkdirSync(join(root, "context"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("flags an invariant with no guard (category A)", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\ninvariant: the token MUST be non-empty\n");
  const r = findFootguns(root);
  expect(r.byCategory.A).toBeGreaterThan(0);
  expect(r.findings.some((f) => f.cat === "A")).toBe(true);
});

test("does not flag an invariant that has a nearby guard", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\ninvariant: token non-empty\nenforce: a lint rule checks it\n");
  expect(findFootguns(root).byCategory.A).toBe(0);
});

test("flags a hazard phrase (category C)", () => {
  writeFileSync(join(root, "context", "db.md"), "# DB\n\nThis silently binds null and corrupts data.\n");
  expect(findFootguns(root).findings.some((f) => f.cat === "C")).toBe(true);
});

test("flags a bullet under a gotcha section (category B)", () => {
  writeFileSync(join(root, "context", "x.md"), "# X\n\n## Gotchas\n\n- the cache key must include the tenant id\n");
  expect(findFootguns(root).findings.some((f) => f.cat === "B")).toBe(true);
});

test("ignores index.md and CLAUDE.local.md", () => {
  writeFileSync(join(root, "context", "index.md"), "invariant: never appears\n");
  writeFileSync(join(root, "CLAUDE.local.md"), "invariant: also never\n");
  const r = findFootguns(root);
  expect(r.scanned).toBe(0);
  expect(r.total).toBe(0);
});

test("a backticked invariant discussion is not mistaken for a claim", () => {
  writeFileSync(join(root, "context", "meta.md"), "# Meta\n\nAn `invariant:` label marks a rule.\n");
  expect(findFootguns(root).byCategory.A).toBe(0);
});

test("flags an ordered multi-command procedure (category D)", () => {
  writeFileSync(
    join(root, "CLAUDE.md"),
    "# repo\n\n- Format the paths BEFORE staging: `pnpm exec oxfmt <paths>` first, then `git add` + `git commit --pathspec-from-file=<f>`.\n",
  );
  const r = findFootguns(root);
  expect(r.byCategory.D).toBeGreaterThan(0);
  expect(r.findings.some((f) => f.cat === "D")).toBe(true);
});

test("a single referenced command is not a procedure", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\nRun `pnpm test` before opening a PR.\n");
  expect(findFootguns(root).byCategory.D).toBe(0);
});

test("two commands with no ordering words are options, not a procedure", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\nUse `pnpm dev` or `pnpm dev:apps` depending on scope.\n");
  expect(findFootguns(root).byCategory.D).toBe(0);
});

test("an invariant acknowledged as external: is not category A", () => {
  writeFileSync(
    join(root, "CLAUDE.md"),
    "# repo\n\ninvariant: the ingest URL is authoritative\nexternal: advertised by program-api; not checkable in-repo\n",
  );
  expect(findFootguns(root).byCategory.A).toBe(0);
});

test("scans docs nested in area dirs, not just top-level context/*.md", () => {
  mkdirSync(join(root, "context", "payments"));
  writeFileSync(join(root, "context", "payments", "ledger.md"), "# Ledger\n\nThis silently drops the fee.\n");
  writeFileSync(join(root, "context", "payments", "index.md"), "- `context/payments/ledger.md` - Use when: silently everything\n");
  const r = findFootguns(root);
  expect(r.findings.some((f) => f.file === "context/payments/ledger.md")).toBe(true);
  expect(r.findings.some((f) => f.file.endsWith("index.md"))).toBe(false);
});
