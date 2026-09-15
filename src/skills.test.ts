import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every skill must satisfy the Agent Skills spec (https://agentskills.io/specification), or
// installers like `npx skills add` and non-Claude agents will reject or mis-load it.

const REPO = join(import.meta.dir, "..");
const SKILLS = join(REPO, "skills");
const ALLOWED_KEYS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

function frontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error("SKILL.md has no YAML frontmatter");
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) out[kv[1]!] = kv[2]!;
  }
  return out;
}

for (const dir of readdirSync(SKILLS)) {
  const skillDir = join(SKILLS, dir);
  const text = readFileSync(join(skillDir, "SKILL.md"), "utf8");

  test(`${dir}: frontmatter follows the Agent Skills spec`, () => {
    const fm = frontmatter(text);
    for (const key of Object.keys(fm)) expect(ALLOWED_KEYS.has(key)).toBe(true);
    expect(fm.name).toBe(dir);
    expect(fm.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(fm.name!.length).toBeLessThanOrEqual(64);
    expect(fm.description!.length).toBeGreaterThan(0);
    expect(fm.description!.length).toBeLessThanOrEqual(1024);
    if (fm.compatibility) expect(fm.compatibility.length).toBeLessThanOrEqual(500);
  });

  test(`${dir}: SKILL.md stays under 500 lines`, () => {
    expect(text.split("\n").length).toBeLessThan(500);
  });

  test(`${dir}: every referenced skill file exists`, () => {
    for (const [, rel] of text.matchAll(/`((?:references|scripts|hooks|assets)\/[\w./-]+)`/g)) {
      expect(existsSync(join(skillDir, rel!))).toBe(true);
    }
  });
}

test("the marketplace lists only skills that exist", () => {
  const market = JSON.parse(readFileSync(join(REPO, ".claude-plugin", "marketplace.json"), "utf8"));
  for (const plugin of market.plugins) {
    for (const rel of plugin.skills) expect(existsSync(join(REPO, rel, "SKILL.md"))).toBe(true);
  }
});

// The bundle is what users run, so exercise IT under plain Node, not the TS source under Bun.
const BUNDLE = join(SKILLS, "context-index", "scripts", "context-index.mjs");
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "context-index-bundle-"));
  mkdirSync(join(root, "context"));
  execFileSync("git", ["init", "-q"], { cwd: root });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const runBundle = (...args: string[]) =>
  spawnSync("node", [BUNDLE, ...args, "--target", root], { encoding: "utf8" });

test("bundle: a clean corpus passes check under Node", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n\n- `context/auth.md` - Use when: touching auth\n");
  writeFileSync(join(root, "context", "auth.md"), "# Auth\n\nUse when: touching auth\n");
  const r = runBundle("check");
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("1 index entry; 0 error(s)");
});

test("bundle: an orphan fails check, and scaffold wires a new doc", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n\nIMPORTANT: read matching docs.\n");
  writeFileSync(join(root, "context", "orphan.md"), "# Orphan\n");
  expect(runBundle("check").status).toBe(1);

  rmSync(join(root, "context", "orphan.md"));
  const r = runBundle("scaffold", "featureFlags", "toggling a feature flag");
  expect(r.status).toBe(0);
  expect(readFileSync(join(root, "context", "index.md"), "utf8")).toContain(
    "- `context/feature-flags.md` - Use when: toggling a feature flag",
  );
});

test("bundle: --quiet prints errors but not warnings", () => {
  writeFileSync(join(root, "CLAUDE.md"), "# repo\n\n@context/index.md\n");
  writeFileSync(join(root, "context", "index.md"), "# Index\n\n- `context/auth.md` - Use when: touching auth\n");
  writeFileSync(join(root, "context", "auth.md"), "# Auth\n\nUse when: touching auth\n\nDone ✓\n");
  writeFileSync(join(root, "context", "orphan.md"), "# Orphan\n");
  const loud = runBundle("check");
  expect(loud.stdout).toContain("decorative check/cross glyph");
  const quiet = runBundle("check", "--quiet");
  expect(quiet.status).toBe(1);
  expect(quiet.stdout).toContain("ERROR context/orphan.md");
  expect(quiet.stdout).not.toContain("decorative check/cross glyph");
  expect(quiet.stdout).toContain("1 error(s), 1 warning(s)");
});

test("bundle: an unknown command exits 2 with usage", () => {
  const r = runBundle("bogus");
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("usage: context-index");
});
